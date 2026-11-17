//! Simülatörün satış mesajları tarafı (fiş başlat, kalem, ödeme, kapat, iptal, sorgu).
//! YALNIZ test ve geliştirme içindir; bkz. `simulator.rs`.

use super::frame::{Gmp3Message, GROUP_BANK, GROUP_PRIVATE};
use super::sale::{
    BasketState, MSG_ABORT_REQ, MSG_BEGIN_REQ, MSG_CLOSE_RECEIPT_REQ, MSG_ITEM_REQ,
    MSG_PAYMENT_REQ, TAG_AMOUNT, TAG_BASKET_ID, TAG_DISCOUNT, TAG_EKU_NO, TAG_ITEM_NAME,
    TAG_LINE_NO, TAG_QUANTITY, TAG_RECEIPT_NO, TAG_STATE, TAG_TAX_BP, TAG_TENDER, TAG_UNIQUE_ID,
    TAG_Z_NO,
};
use super::simulator::{
    err_reply, Fault, Reply, SimBasket, SimState, SimulatedRegister, SIMULATOR_SERIAL,
};
use super::tlv::{bcd_decode, bcd_encode, decode_text, encode_text};
use super::types::{OkcError, OkcResult, TenderKind};

impl SimulatedRegister {
    pub(super) fn amount(request: &Gmp3Message, tag: u32) -> Option<i64> {
        let value = bcd_decode(request.field(GROUP_BANK, tag)?).ok()?;
        i64::try_from(value).ok()
    }

    pub(super) fn open_basket<'a>(
        state: &'a mut SimState,
        request: &Gmp3Message,
    ) -> Option<&'a mut SimBasket> {
        let unique = decode_text(request.field(GROUP_PRIVATE, TAG_UNIQUE_ID)?);
        state
            .baskets
            .values_mut()
            .find(|b| b.unique_id == unique && b.state == BasketState::Open)
    }

    pub(super) fn sale(state: &mut SimState, request: &Gmp3Message) -> Reply {
        match request.msg_type {
            MSG_BEGIN_REQ => Self::begin(state, request),
            MSG_ITEM_REQ => Self::item(state, request),
            MSG_PAYMENT_REQ => Self::payment(state, request),
            MSG_CLOSE_RECEIPT_REQ => Self::close_receipt(state, request),
            MSG_ABORT_REQ => match Self::open_basket(state, request) {
                Some(basket) => {
                    basket.state = BasketState::Aborted;
                    Reply::Fields(Vec::new())
                }
                None => err_reply("50"),
            },
            _ => Self::query(state, request),
        }
    }

    pub(super) fn begin(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let Some(raw) = request.field(GROUP_PRIVATE, TAG_BASKET_ID) else {
            return err_reply("11");
        };
        let basket_id = decode_text(raw);
        if state.fault == Fault::PaperOut {
            return err_reply("40");
        }
        if let Some(existing) = state.baskets.get(&basket_id) {
            match existing.state {
                BasketState::Open => {
                    return Self::unique_reply(&existing.unique_id);
                }
                BasketState::Closed => return err_reply("50"),
                _ => {}
            }
        }
        state.unique_counter += 1;
        let unique_id = format!("{SIMULATOR_SERIAL}-{:06}", state.unique_counter);
        state.baskets.insert(
            basket_id,
            SimBasket {
                unique_id: unique_id.clone(),
                state: BasketState::Open,
                lines: Vec::new(),
                payments: Vec::new(),
                receipt: None,
            },
        );
        Self::unique_reply(&unique_id)
    }

    pub(super) fn unique_reply(unique_id: &str) -> Reply {
        match encode_text(unique_id) {
            Ok(bytes) => Reply::Fields(vec![(GROUP_PRIVATE, TAG_UNIQUE_ID, bytes)]),
            Err(_) => err_reply("90"),
        }
    }

    pub(super) fn item(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let Some(total) = Self::amount(request, TAG_AMOUNT) else {
            return err_reply("51");
        };
        let name = request.field(GROUP_PRIVATE, TAG_ITEM_NAME).map(decode_text);
        let quantity = request
            .field(GROUP_PRIVATE, TAG_QUANTITY)
            .and_then(|v| bcd_decode(v).ok())
            .and_then(|v| i64::try_from(v).ok());
        let tax = request
            .field(GROUP_PRIVATE, TAG_TAX_BP)
            .and_then(|v| bcd_decode(v).ok())
            .and_then(|v| i64::try_from(v).ok());
        let line_no = request
            .field(GROUP_PRIVATE, TAG_LINE_NO)
            .and_then(|v| bcd_decode(v).ok());
        let (Some(name), Some(quantity), Some(tax), Some(line_no)) = (name, quantity, tax, line_no)
        else {
            return err_reply("51");
        };
        let Some(basket) = Self::open_basket(state, request) else {
            return err_reply("50");
        };
        if quantity <= 0 || line_no != basket.lines.len() as u64 + 1 {
            return err_reply("51");
        }
        basket.lines.push((name, quantity, total, tax));
        Reply::Fields(Vec::new())
    }

    pub(super) fn payment(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let declined = state.fault == Fault::CardDeclined;
        let kind = request
            .field(GROUP_PRIVATE, TAG_TENDER)
            .and_then(|v| v.first().copied())
            .and_then(|code| TenderKind::from_wire(code).ok());
        let (Some(kind), Some(amount)) = (kind, Self::amount(request, TAG_AMOUNT)) else {
            return err_reply("11");
        };
        if declined && kind == TenderKind::Card {
            return err_reply("41");
        }
        let Some(basket) = Self::open_basket(state, request) else {
            return err_reply("50");
        };
        basket.payments.push((kind, amount));
        Reply::Fields(Vec::new())
    }

    pub(super) fn close_receipt(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let wrong_total = state.fault == Fault::WrongTotalOnClose;
        let (Some(expected), Some(discount)) = (
            Self::amount(request, TAG_AMOUNT),
            Self::amount(request, TAG_DISCOUNT),
        ) else {
            return err_reply("11");
        };
        state.receipt_counter += 1;
        let number = state.receipt_counter;
        let Some(basket) = Self::open_basket(state, request) else {
            state.receipt_counter -= 1;
            return err_reply("50");
        };
        let gross: i64 = basket.lines.iter().map(|l| l.2).sum();
        let paid: i64 = basket.payments.iter().map(|p| p.1).sum();
        let total = gross - discount;
        if basket.lines.is_empty() || total != expected {
            state.receipt_counter -= 1;
            return err_reply("52");
        }
        if paid != total {
            state.receipt_counter -= 1;
            return err_reply("54");
        }
        basket.state = BasketState::Closed;
        basket.receipt = Some((number, 1, 1, total));
        let reported = if wrong_total { total + 1 } else { total };
        Self::receipt_reply(&basket.unique_id, number, 1, 1, reported)
    }

    pub(super) fn receipt_reply(
        unique_id: &str,
        number: u32,
        z_no: u32,
        eku_no: u32,
        total: i64,
    ) -> Reply {
        let build = || -> OkcResult<Vec<(u32, u32, Vec<u8>)>> {
            Ok(vec![
                (GROUP_PRIVATE, TAG_UNIQUE_ID, encode_text(unique_id)?),
                (
                    GROUP_BANK,
                    TAG_AMOUNT,
                    bcd_encode(
                        u64::try_from(total).map_err(|_| OkcError::Protocol("tutar".into()))?,
                        6,
                    )?,
                ),
                (
                    GROUP_BANK,
                    TAG_RECEIPT_NO,
                    bcd_encode(u64::from(number), 3)?,
                ),
                (GROUP_BANK, TAG_Z_NO, bcd_encode(u64::from(z_no), 3)?),
                (GROUP_BANK, TAG_EKU_NO, bcd_encode(u64::from(eku_no), 2)?),
            ])
        };
        match build() {
            Ok(fields) => Reply::Fields(fields),
            Err(_) => err_reply("90"),
        }
    }

    pub(super) fn query(state: &mut SimState, request: &Gmp3Message) -> Reply {
        let Some(raw) = request.field(GROUP_PRIVATE, TAG_BASKET_ID) else {
            return err_reply("11");
        };
        let basket_id = decode_text(raw);
        let Some(basket) = state.baskets.get(&basket_id) else {
            return Reply::Fields(vec![(
                GROUP_PRIVATE,
                TAG_STATE,
                vec![BasketState::Unknown.wire_code()],
            )]);
        };
        match (basket.state, basket.receipt) {
            (BasketState::Closed, Some((number, z_no, eku_no, total))) => {
                let Reply::Fields(mut fields) =
                    Self::receipt_reply(&basket.unique_id, number, z_no, eku_no, total)
                else {
                    return err_reply("90");
                };
                fields.push((
                    GROUP_PRIVATE,
                    TAG_STATE,
                    vec![BasketState::Closed.wire_code()],
                ));
                Reply::Fields(fields)
            }
            (BasketState::Open, _) => match encode_text(&basket.unique_id) {
                Ok(unique) => Reply::Fields(vec![
                    (
                        GROUP_PRIVATE,
                        TAG_STATE,
                        vec![BasketState::Open.wire_code()],
                    ),
                    (GROUP_PRIVATE, TAG_UNIQUE_ID, unique),
                ]),
                Err(_) => err_reply("90"),
            },
            (other, _) => Reply::Fields(vec![(GROUP_PRIVATE, TAG_STATE, vec![other.wire_code()])]),
        }
    }
}
