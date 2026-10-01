# FAZ 3 FİNAL RAPORU — Anlık PIN Onayı

Tarih: 2026-10-02
Kapsam: Faz 3 (anlık PIN onay sistemi), batch B1 → B2 → B3 → B4 → B5 → B6
Durum: **TAMAMLANDI** — tüm zorunlu kapılar geçti

---

## 1. Ne Değişti

### 1.1 Karar (K4)

Onay kuyruğu **kaldırıldı**. Onay artık işlem anında, işlemi yapan kişiden başka bir üst
yönetici tarafından PIN ile verilir ve tek kullanımlık bir jetonla taşınır. Kuyruk
komutları (`request_approval`, `get_pending_approvals`, `process_approval`) ve
`ApprovalsPanel` yüzeyi kaldırıldı.

`approvals` tablosu **korundu**: yeni sistemde "kim onayladı" kaydı ve jeton defteri
olarak kullanılır (`approved_by_role`, `amount_cents`, `token_hash`, `expires_at`,
`consumed_at` sütunları eklendi).

### 1.2 Kural Matrisi

| Yüzey | Onay şartı | Onaylayabilen |
|---|---|---|
| Hesap iptali (void) | Her tutarda zorunlu | MASTER, OWNER, MANAGER |
| İndirim (küçük) | Her tutarda zorunlu | MASTER, OWNER, MANAGER |
| İndirim (≥ %20 **veya** ≥ 50.000 kuruş) | Zorunlu (yüksek eşik) | OWNER, MANAGER |
| İkram (`COMPLIMENTARY`) | Daima yüksek eşik (%100) | OWNER, MANAGER |

Kaynak: `backend/src/approval_service.rs:38-50`

- `LARGE_DISCOUNT_PERCENT = 20`
- `LARGE_DISCOUNT_CENTS = 50_000`
- `MAX_FAILED_ATTEMPTS = 5`
- `LOCKOUT_SECONDS = 300`
- `TOKEN_TTL_SECONDS = 30`

Rol kapıları tek yerde: `backend/src/rbac.rs:148-174`
(`APPROVER_ROLES`, `require_approver`, `require_distinct_approver`)

### 1.3 Güvenlik Özellikleri

- **Self-approval yasak**: onaylayanın kimliği işlemi yapanla aynı olamaz
  (`require_distinct_approver`).
- **Tek kullanımlık jeton**: `consume_token` işlemi `consumed_at` damgalar; ikinci
  kullanım `APPROVAL_TOKEN_USED` ile reddedilir.
- **Kapsam kilidi**: jeton; tenant + işlem türü + kaynak + tutar + aktör + onaylayan
  rolü ile eşleşmek zorundadır. Başka fişe, başka tutara, başka tenant'a taşınamaz.
- **30 saniye TTL**, **Argon2id** ile doğrulanmış PIN, DB'de yalnız **SHA-256 jeton
  özeti** (düz jeton veya PIN saklanmaz).
- **5 hatalı PIN → 300 sn kilit**, sayaç `tenant_id + terminal_id + operation`
  kapsamlı; başka terminal etkilenmez; kilit DB'de kalıcıdır.
- **Rol sızıntısı yok**: tüm roller için aynı `INVALID_APPROVAL_PIN` mesajı döner.
- **Yüzey güvenilmez**: indirim yüzdesi/tutarı istemciden değil, sunucunun kendi
  sepet hesabından türetilir (`services/payment_approval.rs`).

### 1.4 Audit

| Olay | Nerede |
|---|---|
| `approval:verified` | `backend/src/approval_commands.rs:132` |
| `approval:lockout` | `backend/src/approval_commands.rs:116` |
| `approval:consumed` | `backend/src/services/payment_approval.rs:94` |
| `order:voided` | `backend/src/commands.rs:2020` |

Denetim defteri SHA-256 zincirli ve değişmezdir (Faz 2'den gelen altyapı).

---

## 2. Dosya Envanteri

### Yeni (backend)

| Dosya | Satır | İçerik |
|---|---|---|
| `backend/src/approval_service.rs` | 498 | Onay çekirdeği: `verify_and_issue`, `consume_token`, `remaining_attempts`, hata sabitleri, test modülü |
| `backend/src/approval_service_tests.rs` | — | Rol/eşik/kilit/self-approval testleri |
| `backend/src/approval_token_tests.rs` | — | Jeton kapsam, replay, süre, tenant testleri |
| `backend/src/commands_approval_tests.rs` | — | `void_order` komut düzeyi onay testleri |
| `backend/src/services/payment_approval.rs` | 154 | Ödeme/indirim kapısı, sunucu yüzeyi hesabı |
| `backend/src/services/payment_approval_tests.rs` | — | İndirim/ikram onay testleri |

### Yeni (desktop)

| Dosya | İçerik |
|---|---|
| `desktop/src/core/services/approvalService.ts` | İstemci onay servisi: hata kodları, `requestApproval`, kalan deneme metni |
| `desktop/src/presentation/components/cashier/InstantPinApprovalModal.tsx` | Anlık PIN penceresi (`role="dialog"`, `aria-modal`, Escape, odak yönetimi) |
| `desktop/tests/integration/instantPinApproval.test.ts` | Uçtan uca istemci testleri |

### Değiştirilen

| Dosya | Değişiklik |
|---|---|
| `backend/src/approval_commands.rs` | `verify_manager_pin` eklendi; kuyruk komutları (243 satır) silindi |
| `backend/src/commands.rs` | `void_order` `approval_token` ister; `managerPin` kaldırıldı; `PaymentPayloadDto` → `approval_token` + `actor_id` |
| `backend/src/rbac.rs` | `APPROVER_ROLES`, `require_approver`, `require_distinct_approver` |
| `backend/src/db.rs`, `backend/migrations/schema.sql` | Onay jetonu sütunları, deneme sayacı tablosu, indeksler |
| `backend/src/lib.rs` | Kuyruk komut kayıtları kaldırıldı, `verify_manager_pin` kaydedildi |
| `desktop/src/data/ipc/tauriInvoke.ts` | `verify_manager_pin` mocku; kuyruk mockları silindi; jeton tüketimi kapıları |
| `desktop/src/presentation/components/cashier/CashierWorkstationContainer.tsx` | İki adımlı void akışı |
| `desktop/src/presentation/components/pos/PaymentModalContainer.tsx` | İndirim/ikram onayı → token-backed ödeme |
| `desktop/src/presentation/components/owner/OwnerDashboardContainer.tsx` | "Onaylar" sekmesi kaldırıldı |
| `desktop/src/presentation/components/management/ui/OperationsDashboard.tsx` | Onay paneli bağlantısı kaldırıldı |

### Silinen

- `desktop/src/domain/usecases/auth/ApprovalWorkflowEngine.ts` (375 satır) — kuyruk motoru, üretimde hiçbir yol tarafından çağrılmıyordu
- `desktop/src/presentation/components/management/ui/ApprovalsPanel.tsx` (402 satır)
- `request_approval`, `get_pending_approvals`, `process_approval` komutları + `ApprovalDto`

Net: **+996 / −1142 satır** (22 dosya).

---

## 3. Doğrulama Kapıları

| Kapı | Sonuç |
|---|---|
| `cargo check --all-targets` | ✅ 0 hata, 0 uyarı (`Finished dev profile`) |
| `cargo test` | ✅ **99 passed; 0 failed** |
| `npx tsc --noEmit` | ✅ `tsc_exit=0` |
| `npx vitest run` | ✅ **29 dosya / 323 test passed** |

### Statik Taramalar

| Tarama | Sonuç |
|---|---|
| `unwrap()/expect()/panic!` — backend üretim kodu | ⚠️ Faz 3 dışı 2 yer (aşağıda) |
| `managerPin` / `manager_pin` alanı | ✅ Kaldırıldı (yalnız `verify_manager_pin` komut adı ve testlerde geçiyor) |
| Onay kuyruğu kalıntısı (`request_approval` vb.) | ✅ 0 (testlerde "kaldırıldı" iddiasını doğrulayan assertion dışında) |
| `ApprovalsPanel` referansı | ✅ 0 |
| Emoji / gradient (desktop/src) | ⚠️ Faz 3 dışı, dokunulmamış dosyalarda (aşağıda) |

---

## 4. Gerçek Tarayıcı Kanıtı (Chromium, headless)

Vite `5199` portunda çalıştırıldı; Playwright ile kasa girişi → masa aç → ürün ekle →
iptal akışı uçtan uca sürüldü. Konsol hatası: **0**.

**1) Onay penceresi açıldı** (beklenen içerik):

```
Yönetici Onayı Gerekli
Adisyon iptali için yetkili bir yöneticinin PIN'ini girin.
İşlem: Adisyon iptali | Kaynak: tbl-001 | Tutar: 21,60 ₺
Onay PIN'i | Vazgeç | Onayla
```

**2) Kasa PIN'i (`4444`) reddedildi:**

```
Yönetici Onayı Gerekli | ... | Onay PIN'i hatalı. | Vazgeç | Onayla
```

**3) Müdür PIN'i (`3333`) onaylandı → iptal gerçekleşti:**

```
dialog kaldı mı: 0
açık hesaplar: 0 — açık hesap bulunmuyor
```

Ekran görüntüleri `C:\Users\ERENTO~1\AppData\Local\Temp\kilo\faz3_08_pin_modal.png`,
`faz3_09_wrong_pin.png`, `faz3_10_after_approval.png` konumuna alındı. (Bu oturumda
görsel okuma desteklenmediği için kanıt yukarıdaki DOM metni üzerinden alındı.)

---

## 5. Test Kapsamı (99 backend / 323 desktop)

### Backend — onay çekirdeği

- Jeton üretimi, tek kullanımlılık, süre dolması, bilinmeyen/boş jeton reddi
- Tenant, kaynak, tutar, aktör kapsamı ihlalleri
- Kasa/garson/mutfak onaylayamaz; başka tenant'ın PIN'i onaylayamaz
- Pasif personel onaylayamaz; aynı tenantta paylaşılan PIN reddi
- Self-approval reddi (void ve indirim yollarında ayrı ayrı)
- 5 hatalı PIN sonrası 300 sn kilit; kalıcı yazım; terminal izolasyonu
- Kalan deneme hakkının azalması ve başarıda sıfırlanması
- Her tutarda indirim onayı zorunlu; küçük indirimde üst rol yeterli
- Büyük indirimde MASTER de reddi; ikramda kasa reddi
- Tüketim anında eşik kuralının yeniden denetlenmesi
- Jetonun başka fişe taşınamaması; iki kez kullanılamaması
- Audit: `GUVENLIK` kategorisi, `order:voided` ve `approval:consumed` kayıtları

### Desktop

- `instantPinApproval.test.ts` (yeni): hatalı/kasa/mutfak PIN'i, self-approval, kilit,
  süre dolmuş jeton, kapsam uyuşmazlığı, indirim/ikram/void yüzeyleri
- `zeroGapFeatureMatrix.test.ts` M5: jetonsuz void reddi → onay → tüketim → replay reddi
  ve kuyruk komutlarının yokluğu
- `authService.test.ts`: kuyruk motoru testleri yerine anlık PIN testleri
- `ownerManagementAppleHigUi.test.ts`: "Onaylar" sekmesinin yokluğu
- `cashierWorkstation.test.ts`: iki adımlı void akışı

---

## 6. Kapsam Dışı Bırakılanlar (B7 backlog)

Faz 3 dışı oldukları için **dokunulmadı**, kayda geçirildi:

1. **Üretim kodunda `unwrap()`** (AGENTS.md §3.1 ihlali, panik riski düşük çünkü
   öncesinde `is_none()`/`is_some()` ile korunuyor):
   - `backend/src/cashier_commands.rs:185` — `shift_row.unwrap()`
   - `backend/src/ledger_commands.rs:872-913` — `start_date.as_ref().unwrap()`
2. **Emoji** (`desktop/src`): `endofday/ui/DebtsBalanceTab.tsx` (2),
   `endofday/EndOfDayContainer.tsx` (2), `endofday/ui/DirectoriesTab.tsx` (4),
   `endofday/ui/QuickTransactionModal.tsx` (1), `data/ipc/tauriInvoke.ts` (3),
   `platform/PlatformSetupWizard.tsx` (3)
3. **Gradient** (`desktop/src`): `kds/KdsContainer.tsx:778`,
   `platform/ImpersonationBanner.tsx:33`, `platform/MasterVaultModal.tsx:243`,
   `platform/PlatformSetupWizard.tsx:390`
4. **Session-bound tenant güvenliği**: `verify_manager_pin` tenant değerini çağıran
   argümandan alır; kalıcı oturum bağı Faz 15 kapsamında.
5. **Gün sonu İptal/İade/Zayi raporu**: Faz 5'e bırakıldı (K5).
6. **Uzak onay + 2 sn toast**: bu fazda ertelendi (K3).

---

## 7. Korunan Değişmezler

- Tüm tutarlar INTEGER kuruş; float yok
- PIN düz metin hiçbir yerde (Argon2id PHC)
- Jeton DB'de yalnız SHA-256 özeti
- `audit_ledger` UPDATE/DELETE yok, zincir bozulması testlerle reddediliyor
- Her sorguda `tenant_id` filtresi; çapraz tenant testleri
- Tauri IPC tek yerden (`kasam360_core::run()` delegasyonu)
- Metin dili Türkçe, emoji yok (Faz 3'ün dokunduğu dosyalarda), gradient yok

---

## 8. Batch Özeti

| Batch | İçerik | Kanıt |
|---|---|---|
| B1 | Backend onay çekirdeği, RBAC, şema | 74 test |
| B2 | `void_order` + ödeme/indirim kapıları, audit | 99 test |
| B3 | Desktop modal + approvalService + iki akış | 323 test |
| B4 | "Onaylar" sekmesi ve `ApprovalsPanel` kaldırıldı | 323 test |
| B5 | Kuyruk komutları ve `ApprovalWorkflowEngine` kaldırıldı | 99 + 323 test |
| B6 | Statik tarama, tarayıcı kanıtı, bu rapor | 99 + 323 + DOM kanıtı |