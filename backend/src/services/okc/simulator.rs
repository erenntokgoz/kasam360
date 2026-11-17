//! Kasa simülatörü: ÖKC tarafını taklit eder. YALNIZ test ve geliştirme içindir.
//!
//! Neden var: gerçek cihaz olmadan eşleşme, fiş ve hata akışlarını sınamak için.
//! Neden güvenli: modül yalnız `debug_assertions` veya `test` ile derlenir; sürüm
//! (release) derlemesinde bu kod yoktur ve "SIMULATOR" bağlantı türü reddedilir,
//! böylece üretimde gerçek cihaz yoksa sistem "yazar kasa bağlı değil" der.
//! Simülatör mali değildir: ürettiği fiş numaraları hiçbir mali değer taşımaz ve
//! imza doğrulaması gerçek PÖKC zinciri değil, sabit bir test anahtarıdır.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Local;

use super::crypto::{hmac_sha256, DhKeyPair, SecureChannel, SessionKeys, DH_BYTES};
use super::frame::{
    is_pairing_type, Gmp3Message, GROUP_BANK, GROUP_GIB, GROUP_PAIR, MSG_CLOSE_REQ, MSG_ECHO_REQ,
    MSG_INIT_REQ, MSG_KEYREQ_REQ, TAG_ERROR, TAG_HMAC,
};
use super::pairing::CertificateVerifier;
use super::sale::{
    BasketState, MSG_ABORT_REQ, MSG_BEGIN_REQ, MSG_CLOSE_RECEIPT_REQ, MSG_ITEM_REQ,
    MSG_PAYMENT_REQ, MSG_QUERY_REQ,
};
use super::tlv::bcd_encode;
use super::transport::Transport;
use super::types::{OkcError, OkcResult, TenderKind};

pub const SIMULATOR_SERIAL: &str = "SIM000000001";
const TEST_SIGNING_KEY: &[u8] = b"kasam360-simulator-pokc";

/// Test imzası: HMAC-SHA256 ilk 32 baytta, kalan sıfır (gerçek imza RSA-2048'dir).
fn test_signature(a_value: &[u8]) -> Vec<u8> {
    let mut signature = hmac_sha256(TEST_SIGNING_KEY, a_value).to_vec();
    signature.resize(DH_BYTES, 0);
    signature
}

/// Simülatörün test imzasını doğrulayan sertifika doğrulayıcı. Gerçek zincir
/// doğrulaması DEĞİLDİR; yalnız testlerde ve geliştirme derlemesinde bulunur.
pub struct SimulatorVerifier;

impl CertificateVerifier for SimulatorVerifier {
    fn verify(
        &self,
        certificate: &[u8],
        terminal_serial: &str,
        signed_value: &[u8],
        signature: &[u8],
    ) -> OkcResult<()> {
        if certificate != b"SIMULATOR-CERT" || terminal_serial != SIMULATOR_SERIAL {
            return Err(OkcError::CertificateUnverified(
                "simülatör sertifikası beklenenle aynı değil".to_string(),
            ));
        }
        if !super::crypto::constant_time_eq(&test_signature(signed_value), signature) {
            return Err(OkcError::CertificateUnverified(
                "simülatör imzası geçersiz".to_string(),
            ));
        }
        Ok(())
    }
}

/// Hata enjeksiyonu: gerçek cihazda görülen arızaları taklit eder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    None,
    /// Fiş başlatılamaz (kağıt yok).
    PaperOut,
    /// Kart ödemesi reddedilir.
    CardDeclined,
    /// Bu tipteki istek işlenmeden düşer: cevap da yoktur.
    DropRequest(u32),
    /// İstek işlenir ama cevap kaybolur (kapanıştan sonra bağlantı kopması).
    DropReply(u32),
    /// Cevap bozuk toplamla döner.
    WrongTotalOnClose,
}

#[derive(Debug, Clone)]
pub(super) struct SimBasket {
    pub(super) unique_id: String,
    pub(super) state: BasketState,
    pub(super) lines: Vec<(String, i64, i64, i64)>,
    pub(super) payments: Vec<(TenderKind, i64)>,
    pub(super) receipt: Option<(u32, u32, u32, i64)>,
}

pub(super) struct SimState {
    pub(super) fault: Fault,
    pub(super) keypair: Option<DhKeyPair>,
    pub(super) ext_random: [u8; 16],
    pub(super) okc_random: [u8; 16],
    pub(super) pending: Option<SecureChannel>,
    pub(super) channel: Option<SecureChannel>,
    pub(super) last_seq: u32,
    pub(super) baskets: HashMap<String, SimBasket>,
    pub(super) unique_counter: u32,
    pub(super) receipt_counter: u32,
    pub(super) received: Vec<u32>,
}

/// Paylaşılabilir ÖKC simülatörü.
#[derive(Clone)]
pub struct SimulatedRegister {
    state: Arc<Mutex<SimState>>,
}

impl Default for SimulatedRegister {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) fn err_reply(code: &str) -> Reply {
    Reply::Error(code.to_string())
}

pub(super) enum Reply {
    Fields(Vec<(u32, u32, Vec<u8>)>),
    Error(String),
    Silent,
}

impl SimulatedRegister {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(SimState {
                fault: Fault::None,
                keypair: None,
                ext_random: [0; 16],
                okc_random: [0; 16],
                pending: None,
                channel: None,
                last_seq: 0,
                baskets: HashMap::new(),
                unique_counter: 0,
                receipt_counter: 0,
                received: Vec::new(),
            })),
        }
    }

    pub fn set_fault(&self, fault: Fault) {
        if let Ok(mut state) = self.state.lock() {
            state.fault = fault;
        }
    }

    /// Alınan istek tiplerinin sırası (testlerin akışı doğrulaması için).
    pub fn received_types(&self) -> Vec<u32> {
        match self.state.lock() {
            Ok(state) => state.received.clone(),
            Err(_) => Vec::new(),
        }
    }

    fn count_baskets(&self, predicate: impl Fn(&SimBasket) -> bool) -> usize {
        match self.state.lock() {
            Ok(state) => state.baskets.values().filter(|b| predicate(b)).count(),
            Err(_) => 0,
        }
    }

    pub fn closed_receipts(&self) -> usize {
        self.count_baskets(|b| b.receipt.is_some())
    }

    pub fn open_baskets(&self) -> usize {
        self.count_baskets(|b| b.state == BasketState::Open)
    }

    /// Bir istek paketini işler; cevap paketi veya `None` (cevapsız) döner.
    pub fn handle(&self, packet: &[u8]) -> Option<Vec<u8>> {
        let mut state = self.state.lock().ok()?;
        let channel = state.channel.clone();
        let request = Gmp3Message::decode(packet, None)
            .or_else(|plain_error| match channel.as_ref() {
                Some(channel) => Gmp3Message::decode(packet, Some(channel)),
                None => Err(plain_error),
            })
            .ok()?;
        state.received.push(request.msg_type);
        if state.fault == Fault::DropRequest(request.msg_type) {
            return None;
        }
        let seq = request.seq().ok()?;
        let secure = !is_pairing_type(request.msg_type);
        // Bankacılık grubu varsa HMAC doğrulanır (belge §4.3).
        if secure {
            if let (Some(channel), Ok(Some(content))) =
                (channel.as_ref(), request.group_content(GROUP_BANK))
            {
                let received = request.field(GROUP_PAIR, TAG_HMAC).unwrap_or(&[]);
                if !super::crypto::constant_time_eq(&channel.banking_hmac(&content), received) {
                    return Self::build(&state, &request, seq, err_reply("10"));
                }
            }
        }
        if request.msg_type != MSG_INIT_REQ {
            if seq <= state.last_seq {
                return Self::build(&state, &request, seq, err_reply("55"));
            }
            state.last_seq = seq;
        }
        let drop_reply = state.fault == Fault::DropReply(request.msg_type);
        let reply = Self::dispatch(&mut state, &request);
        if drop_reply {
            return None;
        }
        Self::build(&state, &request, seq, reply)
    }

    fn build(state: &SimState, request: &Gmp3Message, seq: u32, reply: Reply) -> Option<Vec<u8>> {
        let secure = !is_pairing_type(request.msg_type);
        let mut message = Gmp3Message::new(SIMULATOR_SERIAL, request.msg_type + 0x0400)
            .with_stamp(seq, Local::now())
            .ok()?;
        match reply {
            Reply::Silent => return None,
            Reply::Error(code) => {
                message = message.with_field(GROUP_PAIR, TAG_ERROR, code.into_bytes());
            }
            Reply::Fields(fields) => {
                message = message.with_field(GROUP_PAIR, TAG_ERROR, b"00".to_vec());
                for (group, tag, value) in fields {
                    message = message.with_field(group, tag, value);
                }
            }
        }
        let channel = if secure { state.channel.as_ref() } else { None };
        if let (Some(channel), Ok(Some(content))) = (channel, message.group_content(GROUP_BANK)) {
            message = message.with_field(
                GROUP_PAIR,
                TAG_HMAC,
                channel.banking_hmac(&content).to_vec(),
            );
        }
        message.encode(channel).ok()
    }

    fn dispatch(state: &mut SimState, request: &Gmp3Message) -> Reply {
        match request.msg_type {
            MSG_INIT_REQ => Self::init(state, request),
            MSG_KEYREQ_REQ => Self::keyreq(state, request),
            MSG_CLOSE_REQ => Self::close_pairing(state, request),
            MSG_ECHO_REQ => Self::echo(state, request),
            MSG_BEGIN_REQ
            | MSG_ITEM_REQ
            | MSG_PAYMENT_REQ
            | MSG_CLOSE_RECEIPT_REQ
            | MSG_ABORT_REQ
            | MSG_QUERY_REQ => {
                if state.channel.is_none() {
                    return err_reply("90");
                }
                Self::sale(state, request)
            }
            _ => err_reply("90"),
        }
    }

    fn init(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let Some(ext) = request.field(GROUP_GIB, 0xDFC10D) else {
            return err_reply("11");
        };
        let Ok(ext_random) = <[u8; 16]>::try_from(ext) else {
            return err_reply("31");
        };
        let Ok(keypair) = DhKeyPair::generate() else {
            return err_reply("90");
        };
        let mut okc_random = [0u8; 16];
        for (i, byte) in okc_random.iter_mut().enumerate() {
            *byte = (i as u8).wrapping_mul(17).wrapping_add(3);
        }
        state.ext_random = ext_random;
        state.okc_random = okc_random;
        state.keypair = Some(keypair);
        state.channel = None;
        state.pending = None;
        state.last_seq = 0;
        let Ok(prime) = super::crypto::prime().and_then(|p| super::crypto::to_fixed(&p)) else {
            return err_reply("90");
        };
        let pad = |text: &str, len: usize| {
            let mut bytes = text.as_bytes().to_vec();
            bytes.resize(len, b' ');
            bytes
        };
        Reply::Fields(vec![
            (GROUP_GIB, 0xDFC10A, pad("SIMULATOR", 20)),
            (GROUP_GIB, 0xDFC10B, pad("SIM-1", 20)),
            (GROUP_GIB, 0xDFC10C, pad(SIMULATOR_SERIAL, 16)),
            (GROUP_GIB, 0xDFC10E, okc_random.to_vec()),
            (GROUP_PAIR, 0xDFEF0B, pad("sim", 8)),
            (GROUP_PAIR, 0xDFEF01, b"SIMULATOR-CERT".to_vec()),
            (GROUP_PAIR, 0xDFEF0C, prime),
            (GROUP_PAIR, 0xDFEF0D, vec![2]),
            (GROUP_PAIR, 0xDFEF09, vec![1]),
        ])
    }

    fn keyreq(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let (Some(keypair), Some(b_value)) =
            (state.keypair.as_ref(), request.field(GROUP_PAIR, 0xDFEF03))
        else {
            return err_reply("50");
        };
        let Ok(prm) = keypair.shared_secret(b_value) else {
            return err_reply("32");
        };
        let Ok(keys) = SessionKeys::derive(&prm, &state.ext_random, &state.okc_random) else {
            return err_reply("90");
        };
        let a_value = keypair.public.clone();
        state.pending = Some(SecureChannel::new(keys));
        Reply::Fields(vec![
            (GROUP_PAIR, 0xDFEF0A, test_signature(&a_value)),
            (GROUP_PAIR, 0xDFEF03, a_value),
            (GROUP_PAIR, 0xDFEF09, vec![1]),
        ])
    }

    fn close_pairing(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let (Some(pending), Some(check)) =
            (state.pending.clone(), request.field(GROUP_PAIR, 0xDFEF0E))
        else {
            return err_reply("50");
        };
        match pending.key_check_value() {
            Ok(expected) if super::crypto::constant_time_eq(&expected, check) => {
                state.channel = Some(pending);
                state.pending = None;
                match bcd_encode(0, 2) {
                    Ok(counter) => Reply::Fields(vec![
                        (GROUP_PAIR, 0xDFEF02, counter),
                        (GROUP_PAIR, 0xDFEF09, vec![1]),
                    ]),
                    Err(_) => err_reply("90"),
                }
            }
            _ => err_reply("10"),
        }
    }

    fn echo(state: &SimState, request: &Gmp3Message) -> Reply {
        let (Some(channel), Some(check)) =
            (state.channel.as_ref(), request.field(GROUP_PAIR, 0xDFEF0E))
        else {
            return Reply::Silent;
        };
        match channel.key_check_value() {
            Ok(expected) if super::crypto::constant_time_eq(&expected, check) => {
                Reply::Fields(vec![(GROUP_PAIR, 0xDFEF0E, expected.to_vec())])
            }
            _ => err_reply("10"),
        }
    }
}

/// Simülatöre bağlanan taşıma: gönderilen paket anında işlenir, cevap sıraya girer.
/// Cevap yoksa `recv` hemen zaman aşımı verir (testler beklemez).
pub struct SimulatorTransport {
    register: SimulatedRegister,
    inbox: VecDeque<Vec<u8>>,
}

impl SimulatorTransport {
    pub fn new(register: SimulatedRegister) -> Self {
        Self {
            register,
            inbox: VecDeque::new(),
        }
    }
}

impl Transport for SimulatorTransport {
    fn send(&mut self, packet: &[u8]) -> OkcResult<()> {
        if let Some(reply) = self.register.handle(packet) {
            self.inbox.push_back(reply);
        }
        Ok(())
    }

    fn recv(&mut self, _timeout: Duration) -> OkcResult<Vec<u8>> {
        self.inbox.pop_front().ok_or(OkcError::Timeout)
    }
}
