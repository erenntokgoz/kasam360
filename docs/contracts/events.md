# Domain event sözleşmesi — C01 taslağı

Durum: taslak; consumer testleri ve `schemaVersion` geri uyumluluk matrisi geçmeden dondurulmuş kabul edilmez.

## Ortak zarf

```json
{
  "eventId": "evt_01J00000000000000000000000",
  "schemaVersion": 1,
  "tenantId": "tnt_01J00000000000000000000000",
  "type": "subscription.activated",
  "entityId": "sub_01J00000000000000000000000",
  "entityVersion": 1,
  "occurredAt": "2026-11-06T10:00:00Z",
  "correlationId": "cor_01J00000000000000000000000",
  "environment": "test",
  "payload": { "subscriptionId": "sub_01J00000000000000000000000" }
}
```

Zarf alanları JSON'da camelCase, UTC RFC3339 ve `schemaVersion` tamsayıdır. Tenant kapsamlı olayda `tenantId` zorunludur; platform olayı için açıkça `tenantId: null` tanımlanmalıdır. Üretici aynı eventId ile tekrar gönderirse tüketici idempotent olmalıdır. Sıralama yalnız `entityVersion` içinde monoton beklenir; servisler arası global sıra yoktur. Kişisel veri, parola/PIN/PHC, lisans anahtarı, SMTP secret ve ödeme kartı alanları payload'a girmez.

## Güvenli tüketim

- Bilinmeyen `schemaVersion` mutasyonda fail-closed reddedilir ve karantinaya alınır; eski kayıt silinmez.
- `environment=test` olayı yalnız test aboneliği/tenant kapsamına yazılabilir; live entitlement, ödeme veya cihaz hakkı üretmesi reddedilir.
- Provider webhook imzası ham request body üzerinde doğrulanır; replay/idempotency kontrolünden sonra outbox/inbox ile işlenir.
- Event zaman aşımı veya upstream belirsizliği yeni finansal işlem başlatmaz; `OUTCOME_UNKNOWN` uzlaştırma ister.

## Mevcut olaylarla ilişki

Mevcut sync API `operationId`, `tenantId`, `deviceId`, `actorRole`, `intentSha256`, `op`, `createdAt` alanlı yerel operasyon zarfı kullanır. Labs'in SQLite `audit_events` ayrı ticari denetim kaydıdır. Bu iki kayıt türü birbirinin yerine geçmez; yeni `DomainEvent` outbox envelope'u ikisine doğrudan eşitlenmemelidir. Mevcut webhook tipi provider'a özgü bir gövdedir; bu v1 envelope'a migration C04/C05 kapsamındaki adaptörle yapılmalıdır.
