# KASAM360 — Security Audit (G7 · Item 26)

Son guncelleme: 2026-10-09
Kaynak: AGENTS.md §9 (13 P0 Kilid), Faz 15/16.5/17/18

## Kapatilan Aciklar (15)

| # | Aciklik | Durum |
|---|---------|-------|
| 1 | RBAC kapisi: kds/cashier/kitchen/waiter komutlari yetkisiz cagri | Cözüldü |
| 2 | CSP kapali (connect-src 'self' ipc: eklenmisti) | Cözüldü |
| 3 | Master vault reporda gorunuyordu | Cözüldü |
| 4 | PIN rate-limit kirligani (5 deneme + busy_timeout 5000) | Cözüldü |
| 5 | Default PIN zorla degistirme zorunlugu | Cözüldü |
| 6 | Outbox tuketici yok (dispatcher worker eklendi) | Cözüldü |
| 7 | i32 okuma + sessiz sifir donusu (DomainError + proptest) | Cözüldü |
| 8 | tax_rate REAL -> basis-point i64 | Cözüldü |
| 9 | Surumlu migration yok (migrate.rs eklendi) | Cözüldü |
| 10 | 270 unwrap_or(0) finansal kapi (§3.4 kurali) | Cözüldü |
| 11 | Log framework yok (tracing + rolling file) | Cözüldü |
| 12 | ID terminal-koru (generate_terminal_id) | Cözüldü |
| 13 | Offline conflict policy (docs/OFFLINE-CONFLICT-POLICY.md) | Cözüldü |
| 14 | Compensation commands (void/refund onay kapilari) | Cözüldü |
| 15 | Guard macro (require_any/require_owner) | Cözüldü |

## Kalan Bilinen Aciklar (Faz 18)

- Theoretical vs Actual COGS fark raporu
- Multi-branch isolation (cross-branch transfer)
- Dynamic KDS routing (tarife gore istasyon)
- Menu engineering matrix (ABC analizi)
- Hardware abstraction layer (printer/barkod/para kutusu)
- Caller ID / Delivery / WhatsApp bot
- Sadakat & hediye karti
- e-Arşiv gerçek entegratör (GİB API)
- ÖKC/fiscal gerçek protokol

Detay: docs/FAZ-18-BACKLOG.md

## Red Team Senaryolari (test edilmis)

1. Cross-tenant sorgu -> hata doner (proptest::tenant_isolation_returns_err)
2. Kuruş tasmasi -> Err doner, 0 donmez (proptest::prop_kurus_tasmaz)
3. Split payment bakiye uymazsa -> hata doner (proptest::prop_split_asar_hata)
4. ULID uniqueness 1000 uretim -> hepsi unique (proptest::ulid_unique_1000)
5. Backup checksum uymazsa -> hata doner (backup_checksum_uymazsa_hata_doner)
6. Backup olmayan dosya -> Missing hatasi (backup_olmayan_dosya_hata)
7. Negatif split -> hata doner (proptest::prop_split_negatif_hata)
8. Overpaid split -> hata doner (proptest::prop_split_asar_hata)
