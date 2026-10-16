# Offline Conflict Policy — KASAM360

> Bu belge, aynı anda birden fazla terminalin aynı masa / sipariş / ödeme
> üzerinde çalıştığı **offline / yarı-online** senaryolarındaki çatışma çözüm
> politikasını tanımlar. Politika, veritabanı (optimistik kilitle, trigger) ve
> uygulama katmanı (komutlar, audit ledger) arasında **iki katmanla** korunur:
> birincil kilitleme DB/JSON seviyesindedir; ikincil çatışma kaydı (conflict_log)
> geçmişe dönük inceleme için tutulur.

---

## 1. Çatışma Tipleri

| Tip | Tanım | Çözüm |
|-----|-------|-------|
| **Masa kilidi** | Aynı masanın iki terminali aynı anda açık tutmak ister | OPTIMISTIC LOCK (`try_lock_table`) — 30 sn TTL |
| **ID çakışması** | İki terminal aynı sipariş/fiş ID'sini üretir | `terminal_id` prefix |
| **Sipariş çakışması** | İki terminal aynı sipariş ID'sine satır ekler | MERGE — çakışan kalemler `conflict_log` |
| **Ödeme çakışması** | İki terminal aynı tutarı/ödeme kaydını yazar | LAST-WRITE-WINS (para otoritesi backend) |

---

## 2. Masa Kilidi (Optimistic Lock)

### Mekanizma

`try_lock_table(table_id, waiter_id)` komutu, masa kimliği üzerine **in-memory**
bir kilitleme alır. Kilitleme:

- **30 saniye TTL**: 30 saniye boyunca başka terminal aynı masayı kapatan
  kullanıcının kimliğiyle geri döner: `"Masa X şu anda [kullanıcı] tarafından
  açık"`.
- **Süre dolduktan sonra otomatik unlock**: 30 saniye sonra kilte sahibi
  olunmadan aynı masayı yeniden kilitleyebilirsiniz.
- **`unlock_table(table_id, waiter_id)`**: Kapatma sadece kilit sahibi tarafından
  yapılır; başka terminal kapatamaz.

### Çatışma Senaryosu: 2 Terminal, Aynı Masa

```
Terminal A: try_lock_table("tbl_01", "waiter_a")  → Ok(true)
Terminal B: try_lock_table("tbl_01", "waiter_b")  → Err("Masa tbl_01 şu anda waiter_a tarafından açık")

30 saniye sonra otomatik unlock:
Terminal B: try_lock_table("tbl_01", "waiter_b")  → Ok(true)
```

**Hangi sipariş kazanır?** — Kilidi alan terminal, masanın o anki sahibidir.
Diğer terminalin yaptığı tüm yazma (sipariş ekleme, güncelleme) çelişir ve
çözümleme için `conflict_log` tablosu kullanılır.

---

## 3. ID Çakışması (Terminal Prefix)

### Sorun

Offline sırada iki terminal aynı `txn_id` ya da `order_id` üretebilir. UUID v4
çakışması istatistiksel olarak imkânsızdır, ama **terminal bazlı ID
üretiminde** aynı UUID'lerin tekrarlanması mümkündür.

### Çözüm

`id_generator::generate_terminal_id()` ile her terminal kendine
özel bir `dev_` prefix'li kimlik üretir. Tüm offline kayıtlar bu `terminal_id`
ile etiketlenır:

- `orders.id` = `{terminal_id}_{ulid}`
- `events.event_id` = `evt_sale_{terminal_id}_{uuid}`
- `audit_ledger.resource_id` = orijinal ID (terminal prefix içerir)

Bu sayede aynı ID çakışması asla olmaz; farklı terminalde aynı sipariş ID'si
doğrudan anlambilirsizdir.

---

## 4. Sipariş Birleştirme (Merge)

### Senaryo

İki terminal, aynı masa için **aynı `order_id`** (örneğin offline senaryoda
kullanıcı tarafından doğrudan girilen) ID'sine satır ekler.

### Politika

1. **Eldeki sipariş güncellenir**: Yeni kalem eklenir.
2. **Tamamen aynı kalem** (product_id + modifiers aynıysa): Miktar toplanarak
   tekilleştirilir (commute — toplama değişmez).
3. **Çakışan kalem** (aynı product_id, farklı fiyat/modifier): `conflict_log`
   tablosuna kaydedilir; kullanıcı tarafından çözüme gidene kadar `PENDING`
   durumda kalır.

### conflict_log Şeması

```sql
CREATE TABLE IF NOT EXISTS conflict_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL
        CHECK (conflict_type IN ('LINE_ITEM_DUPLICATE', 'LINE_ITEM_PRICE_MISMATCH', 'ORDER_STATUS_CONFLICT')),
    terminal_a TEXT NOT NULL,
    terminal_b TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RESOLVED_MERGE', 'RESOLVED_REJECT', 'AUTO_MERGED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at DATETIME,
    resolved_by TEXT,
    resolution TEXT
);
```

---

## 5. Ödeme: Last-Write-Wins (Para Otoritesi Backend)

### Politika

- **Para hareketi tek kaynaktır**: `audit_ledger.action = 'payment:settled_fifo'`
  kaydı, para hareketinin tek tanımıdır.
- **Son yazan kazanır**: Aynı `transaction_id` için ikinci bir `insert_sale_event`
  çelişkili ise, `check_idempotency` kontrolü **ilk yazıyı korur**, ikincisini
  `IDEMPOTENCY_CONFLICT` hatasıyla reddeder.
- **Gerçek para transferi** aynı ID ile tekrarlanamaz: `events` tablosundaki
  `event_id` PRIMARY KEY'i doğal olarak bir kaydı engeller.
- **Refund / compensation**: Geri ödeme aynı logikle, fakat **ters** kayıt olarak
  `audit_ledger.action = 'payment:compensation_refund'` veya
  `'order:compensation_void'` olarak yazılır.

### Senaryo: 2 Terminal, Aynı Ödeme

```
Terminal A: process_payment(txn_01)  → audit_ledger: payment:settled_fifo
Terminal B: process_payment(txn_01)  → Err(IDEMPOTENCY_CONFLICT)
```

---

## 6. Audit Ledger ve Ters Kayıt (Compensation)

### Void Compensation

Ödenmiş bir siparişi iptirmek (P0 Güvenlik Kilidi #11 — `void_order` PAID/CLOSED
reddedilir) için `create_compensation_void` kullanılır:

1. Sipariş durumu değişmez (PAID kalır) — geçmişe dönük doğruluk için.
2. **Ters işlem** kaydı `audit_ledger`'e `action = 'order:compensation_void'`
   olarak eklenir; payload `originalAmountCents`, `originalOrderId`, ve
   `compensationReason` içerir.
3. Zincirin bütünlüğü korunur: yeni kayık zincirin ucuna bağlanır, `previous_hash`
   doğru zincirinin hash'ine eşittir.

### Payment Refund

```rust
create_compensation_refund(
    tenant_id,
    original_transaction_id,
    amount_cents,
    reason,
)
```

- `txn_refund_<terminal_id>` prefix'li yeni bir transaction ID üretir.
- Ters kaydı `audit_ledger.action = 'payment:compensation_refund'` olarak yazar.
- `refunds` tablosuna da kaydeder (para akışı izi).

---

## 7. Frontend Entegrasyonu

- **10 saniyelik Undo**: Kullanıcı ödeme/void yaptıktan sonra 10 saniye içinde
  "Geri Al" butonu görünür. Bu, `create_compensation_void` /
  `create_compensation_refund` komutlarını çağırır.
- **Conflict gösterge**: `conflict_log` `PENDING` kayıtları, KDS ve kasada
  canlı bildirimle gösterilir.

---

## 8. Test Matrisi

| Senaryo | Komut | Beklenen Sonuç |
|---------|-------|----------------|
| 2 terminal, aynı masa | `try_lock_table` | İkinci terminal `Err` döner |
| 30 sn sonra yeniden kilitle | `try_lock_table` (zaman simülasyonu) | `Ok(true)` |
| Paid sipariş → compensation void | `create_compensation_void` | `audit_ledger` yeni satır, zincir geçerli |
| Refund → compensation | `create_compensation_refund` | `refunds` tablosu + `audit_ledger` |
| ID çakışması (terminal prefix) | `id_generator` | Farklı prefix → benzersiz |
| Order merge, çakışan kalem | merge mantığı | `conflict_log` PENDING |

---

## 9. İlgili Dosyalar

- `backend/src/commands/floor_commands.rs:try_lock_table` — Masa kilidi
- `backend/src/commands/void_commands.rs` — `void_order`, `create_compensation_void`
- `backend/src/commands/payment_commands.rs` — `process_payment`, `create_compensation_refund`
- `backend/src/services/audit_service.rs` — `AuditLedger` zincir yönetimi
- `backend/src/id_generator.rs` — `generate_terminal_id()`
- `backend/migrations/schema.sql` — `conflict_log`, `refunds` tabloları
