//! Simülatöre karşı uçtan uca protokol testleri: eşleşme, fiş, hata ve belirsiz sonuç.
//! Gerçek cihazla yapılmış sınama DEĞİLDİR.

use std::time::Duration;

use super::frame::{MSG_CLOSE_REQ, MSG_ECHO_REQ, MSG_INIT_REQ, MSG_KEYREQ_REQ};
use super::pairing::RejectingVerifier;
use super::sale::{
    MSG_BEGIN_REQ, MSG_CLOSE_RECEIPT_REQ, MSG_ITEM_REQ, MSG_PAYMENT_REQ, MSG_QUERY_REQ,
};
use super::session::{OkcClient, SoftwareIdentity};
use super::simulator::{
    Fault, SimulatedRegister, SimulatorTransport, SimulatorVerifier, SIMULATOR_SERIAL,
};
use super::transport::Transport;
use super::types::{OkcError, OkcResult, ReceiptDraft, ReceiptLine, ReceiptPayment, TenderKind};

fn client_for(register: &SimulatedRegister) -> OkcClient {
    OkcClient::new(
        Box::new(SimulatorTransport::new(register.clone())),
        SIMULATOR_SERIAL,
        Duration::from_millis(50),
        SoftwareIdentity::default(),
    )
}

fn paired(register: &SimulatedRegister) -> OkcClient {
    let mut client = client_for(register);
    client.pair(&SimulatorVerifier).expect("eşleşme");
    client
}

fn draft(basket: &str) -> ReceiptDraft {
    ReceiptDraft {
        basket_id: basket.to_string(),
        lines: vec![
            ReceiptLine {
                name: "Çay".to_string(),
                quantity_milli: 2000,
                total_cents: 5000,
                tax_bp: 1000,
            },
            ReceiptLine {
                name: "Şişe bira".to_string(),
                quantity_milli: 1000,
                total_cents: 18000,
                tax_bp: 2000,
            },
        ],
        discount_cents: 300,
        payments: vec![
            ReceiptPayment {
                kind: TenderKind::Cash,
                amount_cents: 10000,
            },
            ReceiptPayment {
                kind: TenderKind::Card,
                amount_cents: 12700,
            },
        ],
    }
}

#[test]
fn pairing_builds_a_working_secure_channel() {
    let register = SimulatedRegister::new();
    let mut client = client_for(&register);
    let info = client.pair(&SimulatorVerifier).expect("eşleşme");
    assert_eq!(info.okc_serial, SIMULATOR_SERIAL);
    assert!(client.is_paired());
    client.echo().expect("echo");
    assert_eq!(
        register.received_types(),
        vec![MSG_INIT_REQ, MSG_KEYREQ_REQ, MSG_CLOSE_REQ, MSG_ECHO_REQ]
    );
}

#[test]
fn default_verifier_fails_closed_and_blocks_sales() {
    let register = SimulatedRegister::new();
    let mut client = client_for(&register);
    let result = client.pair(&RejectingVerifier);
    assert!(matches!(result, Err(OkcError::CertificateUnverified(_))));
    assert!(!client.is_paired());
    assert!(matches!(
        client.issue_receipt(&draft("txn_a")),
        Err(OkcError::NotPaired(_))
    ));
    assert_eq!(register.closed_receipts(), 0);
}

#[test]
fn full_receipt_flow_with_mixed_tenders_and_discount() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    let receipt = client.issue_receipt(&draft("txn_1")).expect("fiş");
    assert_eq!(receipt.total_cents, 22700);
    assert_eq!(receipt.receipt_no, 1);
    assert!(receipt.unique_id.starts_with(SIMULATOR_SERIAL));
    let sale: Vec<u32> = register.received_types().into_iter().skip(3).collect();
    assert_eq!(
        sale,
        vec![
            MSG_QUERY_REQ,
            MSG_BEGIN_REQ,
            MSG_ITEM_REQ,
            MSG_ITEM_REQ,
            MSG_PAYMENT_REQ,
            MSG_PAYMENT_REQ,
            MSG_CLOSE_RECEIPT_REQ
        ]
    );
}

#[test]
fn retry_with_same_basket_never_issues_a_second_receipt() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    let first = client.issue_receipt(&draft("txn_2")).expect("ilk");
    let again = client.issue_receipt(&draft("txn_2")).expect("tekrar");
    assert_eq!(first, again);
    assert_eq!(register.closed_receipts(), 1);
    // Aynı sepet farklı tutarla gelirse sessizce eski fiş dönmez.
    let mut changed = draft("txn_2");
    changed.discount_cents = 0;
    changed.payments[1].amount_cents = 13000;
    assert!(matches!(
        client.issue_receipt(&changed),
        Err(OkcError::Validation(_))
    ));
}

#[test]
fn invalid_draft_is_rejected_before_anything_is_sent() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    let before = register.received_types().len();
    let mut bad = draft("txn_3");
    bad.payments[0].amount_cents = 1;
    assert!(matches!(
        client.issue_receipt(&bad),
        Err(OkcError::Validation(_))
    ));
    let mut emoji = draft("txn_3");
    emoji.lines[0].name = "Kahve ☕".to_string();
    assert!(client.issue_receipt(&emoji).is_err());
    assert_eq!(register.received_types().len(), before);
}

#[test]
fn declined_card_aborts_the_open_receipt() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    register.set_fault(Fault::CardDeclined);
    let error = client.issue_receipt(&draft("txn_4")).expect_err("ret");
    assert!(matches!(error, OkcError::Rejected { ref code, .. } if code == "41"));
    assert_eq!(register.closed_receipts(), 0);
    assert_eq!(register.open_baskets(), 0, "açık fiş bırakılmamalı");
    // Kart sorunu giderilince aynı sepet kimliğiyle fiş kesilir.
    register.set_fault(Fault::None);
    assert!(client.issue_receipt(&draft("txn_4")).is_ok());
    assert_eq!(register.closed_receipts(), 1);
}

#[test]
fn paper_out_is_reported_with_its_code() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    register.set_fault(Fault::PaperOut);
    let error = client.issue_receipt(&draft("txn_5")).expect_err("kağıt");
    assert!(matches!(error, OkcError::Rejected { ref code, .. } if code == "40"));
}

#[test]
fn lost_reply_after_close_is_recovered_by_query() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    register.set_fault(Fault::DropReply(MSG_CLOSE_RECEIPT_REQ));
    let receipt = client.issue_receipt(&draft("txn_6")).expect("kurtarma");
    assert_eq!(receipt.total_cents, 22700);
    assert_eq!(register.closed_receipts(), 1);
}

#[test]
fn lost_request_leaves_outcome_unknown_then_retry_completes_once() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    register.set_fault(Fault::DropRequest(MSG_CLOSE_RECEIPT_REQ));
    let error = client.issue_receipt(&draft("txn_7")).expect_err("belirsiz");
    assert!(matches!(error, OkcError::OutcomeUnknown(_)));
    assert_eq!(register.closed_receipts(), 0);
    assert_eq!(register.open_baskets(), 1);
    register.set_fault(Fault::None);
    let receipt = client.issue_receipt(&draft("txn_7")).expect("tekrar");
    assert_eq!(receipt.total_cents, 22700);
    assert_eq!(register.closed_receipts(), 1);
    assert_eq!(register.open_baskets(), 0);
}

#[test]
fn device_reporting_a_different_total_is_not_trusted() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    register.set_fault(Fault::WrongTotalOnClose);
    let error = client.issue_receipt(&draft("txn_8")).expect_err("toplam");
    assert!(matches!(error, OkcError::Protocol(_)));
}

#[test]
fn replayed_sequence_numbers_are_refused_by_the_device() {
    let register = SimulatedRegister::new();
    let mut client = paired(&register);
    client.seq = 0;
    let error = client.echo().expect_err("tekrar");
    assert!(matches!(error, OkcError::Rejected { ref code, .. } if code == "55"));
}

/// Cevabın terminal seri numarasını bozan taşıma: sahte cihaz cevabını taklit eder.
struct SerialTamper(SimulatorTransport);

impl Transport for SerialTamper {
    fn send(&mut self, packet: &[u8]) -> OkcResult<()> {
        self.0.send(packet)
    }
    fn recv(&mut self, timeout: Duration) -> OkcResult<Vec<u8>> {
        let mut packet = self.0.recv(timeout)?;
        packet[3] ^= 0x01;
        Ok(packet)
    }
}

#[test]
fn response_from_another_terminal_is_rejected() {
    let register = SimulatedRegister::new();
    let mut client = OkcClient::new(
        Box::new(SerialTamper(SimulatorTransport::new(register))),
        SIMULATOR_SERIAL,
        Duration::from_millis(50),
        SoftwareIdentity::default(),
    );
    assert!(matches!(
        client.pair(&SimulatorVerifier),
        Err(OkcError::Protocol(_))
    ));
    assert!(!client.is_paired());
}

#[test]
fn no_device_reply_is_a_timeout_not_a_success() {
    let register = SimulatedRegister::new();
    register.set_fault(Fault::DropRequest(MSG_INIT_REQ));
    let mut client = client_for(&register);
    assert_eq!(client.pair(&SimulatorVerifier), Err(OkcError::Timeout));
}
