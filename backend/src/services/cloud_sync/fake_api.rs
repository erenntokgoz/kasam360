//! Testlerin bellek içi bulut sunucusu.
//!
//! Sözleşmenin (`docs/cloud-sync.md`) davranışını taklit eder: işlem kimliğiyle tekrar
//! eleme, kiracı başına boşluksuz sıra, sayfalı çekme ve sayım eşleşirse silme onayı.
//! Hata kuyrukları ağ kopmasını ve yanıtı kaybolmuş kabulü canlandırır.

use super::api::{ApiError, CloudApi, Credentials};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Default)]
pub struct Cloud {
    pub log: Vec<Value>,
    pub push_errors: VecDeque<ApiError>,
    pub release_errors: VecDeque<ApiError>,
    /// Kabul edilir ama yanıt kaybolur: aynı grup yeniden gönderilmelidir.
    pub lose_push_reply: bool,
    /// Sunucunun tek istekte aldığı en çok işlem; aşılırsa 413.
    pub max_operations: Option<usize>,
    pub push_calls: usize,
    pub release_calls: usize,
    /// Anlık görüntü sayfaları sırayla döner; hata girişi indirmenin yarıda kopmasını canlandırır.
    pub snapshot_pages: VecDeque<Result<Value, ApiError>>,
}

#[derive(Clone, Default)]
pub struct FakeApi(pub Arc<Mutex<Cloud>>);

pub fn transient() -> ApiError {
    ApiError::Transient("ağ yok".to_string())
}

pub fn rejected(status: u16, code: &str) -> ApiError {
    ApiError::Rejected {
        status,
        code: code.to_string(),
        message: String::new(),
        detail: Value::Null,
    }
}

impl FakeApi {
    pub fn cloud(&self) -> MutexGuard<'_, Cloud> {
        match self.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn accept(&self, body: &str) -> Result<Value, ApiError> {
        let mut cloud = self.cloud();
        cloud.push_calls += 1;
        if let Some(error) = cloud.push_errors.pop_front() {
            return Err(error);
        }
        let parsed: Value = serde_json::from_str(body).map_err(|_| rejected(400, "BAD_JSON"))?;
        let operations = parsed
            .get("operations")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| rejected(400, "BAD_BODY"))?;
        if cloud
            .max_operations
            .is_some_and(|max| operations.len() > max)
        {
            return Err(rejected(413, "PAYLOAD_TOO_LARGE"));
        }
        let mut accepted = Vec::new();
        for mut operation in operations {
            let id = operation.get("operationId").cloned().unwrap_or(Value::Null);
            let existing = cloud
                .log
                .iter()
                .find(|stored| stored.get("operationId") == Some(&id))
                .and_then(|stored| stored.get("seq").cloned());
            let seq = match existing {
                Some(seq) => seq,
                None => {
                    let seq = json!(cloud.log.len() + 1);
                    if let Some(map) = operation.as_object_mut() {
                        map.insert("seq".to_string(), seq.clone());
                    }
                    cloud.log.push(operation);
                    seq
                }
            };
            accepted.push(json!({ "operationId": id, "seq": seq }));
        }
        if cloud.lose_push_reply {
            cloud.lose_push_reply = false;
            return Err(transient());
        }
        Ok(json!({ "accepted": accepted }))
    }
}

impl CloudApi for FakeApi {
    async fn push(&self, _credentials: &Credentials, body: String) -> Result<Value, ApiError> {
        self.accept(&body)
    }

    async fn pull(
        &self,
        _credentials: &Credentials,
        after: i64,
        limit: i64,
    ) -> Result<Value, ApiError> {
        let cloud = self.cloud();
        let newer: Vec<Value> = cloud
            .log
            .iter()
            .filter(|op| {
                op.get("seq")
                    .and_then(Value::as_i64)
                    .is_some_and(|seq| seq > after)
            })
            .cloned()
            .collect();
        let take = usize::try_from(limit)
            .unwrap_or(usize::MAX)
            .min(newer.len());
        let page = newer[..take].to_vec();
        let next_after = page
            .last()
            .and_then(|op| op.get("seq"))
            .and_then(Value::as_i64)
            .unwrap_or(after);
        Ok(json!({
            "tenantId": "tnt_a",
            "operations": page,
            "nextAfter": next_after,
            "hasMore": take < newer.len(),
        }))
    }

    async fn snapshot(
        &self,
        _credentials: &Credentials,
        _as_of: Option<i64>,
        _cursor: Option<String>,
        _limit: i64,
    ) -> Result<Value, ApiError> {
        self.cloud()
            .snapshot_pages
            .pop_front()
            .unwrap_or_else(|| Err(rejected(404, "NOT_IN_TEST")))
    }

    /// Kasanın bildirdiği sayı buluttakiyle eşleşirse silmeye izin verilir.
    async fn release(&self, _credentials: &Credentials, body: String) -> Result<Value, ApiError> {
        let mut cloud = self.cloud();
        cloud.release_calls += 1;
        if let Some(error) = cloud.release_errors.pop_front() {
            return Err(error);
        }
        let parsed: Value = serde_json::from_str(&body).map_err(|_| rejected(400, "BAD_JSON"))?;
        let origin = parsed.get("originDeviceId").cloned().unwrap_or(Value::Null);
        let claimed = parsed.get("operationCount").and_then(Value::as_i64);
        let stored = cloud
            .log
            .iter()
            .filter(|op| op.get("deviceId") == Some(&origin))
            .count();
        if claimed == i64::try_from(stored).ok() {
            return Ok(json!({ "safeToWipe": true }));
        }
        Err(rejected(409, "PENDING_OPERATIONS"))
    }
}
