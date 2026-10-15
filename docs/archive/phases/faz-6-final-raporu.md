# FAZ 6 — FINAL RAPORU

**Kapsam:** Şube yönetiminin yalnız platform yöneticisine (MASTER) bağlanması;
patron panelindeki "Şubeler" sekmesinin kaldırılması; patronun şube üzerindeki
tek yetkisinin `TopHeader` içindeki geçiş açılır listesi olması; kapalı
`feat_multi_branch` işletmesinde şube yüzeyinin **404** dönmesi.

**Tarih:** 2026-10-02
**Durum:** B1–B6 tamamlandı, tüm zorunlu kapılar geçti.

---

## 1. Ne değişti

### 1.1 Patron panelindeki şube yönetimi kaldırıldı

| Silinen dosya | Satır | Yerine |
|---|---|---|
| `owner/ui/OwnerBranchesTab.tsx` | 459 | `platform/ui/PlatformBranchesPanel.tsx` + `layout/BranchSwitcher.tsx` |

- `OwnerDashboardContainer`: `OwnerTabId` birliğinden `'settings'` çıkarıldı,
  `buildOwnerNavItems` listesinden "Şubeler" sekmesi silindi, render dalı
  kaldırıldı. Artık patron panelinde şube yönetimi yüzeyi **yoktur**.
- Silinen yüzeydeki sahte `MetricMiniLine` sparkline ve `DEFAULT_TENANT`
  fallback'ı da birlikte kalktı (AGENTS.md §3.2, §8).
- `TopHeader` içindeki pasif şube rozeti, `BranchSwitcher` bileşeniyle
  değiştirildi: rozet yalnız görüntü değil, **tıklanabilir geçiş** oldu.

### 1.2 Yetki modeli

| İşlem | OWNER | MANAGER | CASHIER/WAITER/KITCHEN | MASTER |
|---|---|---|---|---|
| `get_branches` | kendi tenant'ı | kendi tenant'ı | reddedilir | hedef tenant |
| `create_branch` | reddedilir | reddedilir | reddedilir | ✔ |
| `update_branch` | reddedilir | reddedilir | reddedilir | ✔ |
| `archive_branch` | reddedilir | reddedilir | reddedilir | ✔ |

Silme yoktur: arşivleme `status = 'ARCHIVED'` yapar. Son aktif şube
arşivlenemez (kasa ve vardiya akışları bir şubeye bağlıdır). Aynı tenant
içinde aynı isimli ikinci aktif şube açılamaz.

### 1.3 Backend

```
backend/src/services/branch_service.rs        (201 satır — SQL kuralları)
backend/src/services/branch_service_tests.rs  (193 satır — 12 test)
backend/src/branch_commands.rs                (324 satır — 4 komut + 9 test)
```

- Tüm sorgular `tenant_id` ile daraltıldı; komut katmanı tenant'ı **çağırandan
  değil oturumdan** alır.
- Şube yazmaları `branch:created`, `branch:updated`, `branch:archived` denetim
  kayıtları üretir (`audit_mutex` kilidiyle, tek transaction içinde).
- Yeni kimlikler `br_` prefexlidir (AGENTS.md §2).

### 1.4 Özellik bayrağı ve 404

- `useFeatureFlags` artık `feat_multi_branch` için MASTER'a "her şey açık"
  muafiyeti vermez. Saf yardımcı `isMultiBranchEnabledForModules(modules, role)`
  eklendi: bayrağın sahibi **işletmedir**, MASTER değil.
- `PlatformBranchesPanel` seçili işletmenin `modules` listesinden bayrağı okur;
  kapalıysa `FeatureDisabledNotice` ile **404 yüzeyi** gösterir (AGENTS.md §3.3).
- `BranchSwitcher` iki kapıya bağlıdır: bayrak açık **ve** rol `OWNER`/`MANAGER`.
  Tek şubeli işletmede açılır liste açılmaz, yalnız rozet görünür.

### 1.5 Oturum kalıcılığı

`useAuthStore.setBranch` artık seçimi yalnız bellekte tutmuyor; terminal
oturumu (`kasam360_terminal_session`) içine de yazıyor. Sayfa yenilendiğinde
geçiş kaybolmuyor ve üst bardaki rozet eski şubeyi göstermiyor.

---

## 2. Güvenlik bulguları

### 2.1 Çözülen açıklar

| Bulgu | Sonuç |
|---|---|
| `get_branches` hedef tenant'ı çağırandan alıyordu; oturum tenant'ı ile karşılaştırma yoktu → **OWNER başka işletmenin şubelerini okuyabiliyordu** | `resolve_target_tenant` eklendi: MASTER hedef seçer, diğer roller yalnız kendi tenant'ı; çapraz istek `FORBIDDEN` |
| Komutlarda `caller_tenant_id` hiç taşınmıyordu | `tauriInvoke` oturum tenant'ını ayrı alanda enjekte ediyor; backend imzalarına eklendi |
| `create_branch` RBAC'sizdi; patron şube açabiliyordu | `require_master_present` |
| Yeni `update_branch` / `archive_branch` komutları hiç yoktu | eklendi ve `lib.rs` içine kaydedildi |
| Tenant boş geldiğinde `DEFAULT_TENANT` fallback'i kullanılıyordu | fail-closed: tenant çözülemiyorsa hiçbir rol geçemiyor |
| MASTER için tüm bayraklar "açık" sayılıyordu | `feat_multi_branch` bu muafiyetten çıkarıldı |

### 2.2 Kalan değerlendirme

- `get_branches` okuması MASTER için platform işi olduğundan çapraz tenant'a
  açıktır; bu, `get_tenants` ile aynı yetki modelidir ve yazma yine de hedef
  tenant zorunluluğuna tabidir.
- Platform paneli arşivli şubeleri de listeler ve "Arşiv" rozetiyle ayırır.
  Silme olmadığı için kayıt kaybolmaz; bu bilinçli bir tercihtir.

---

## 3. Test kanıtı

### Backend

```
cargo check --all-targets   → 0 hata, 0 uyarı
cargo test                  → 174 passed; 0 failed
```

Yeni kapılar: `branch_commands` içinde 9 test (rol kapıları, tenant
çözümlemesi, çapraz tenant reddi, `br_` prefex), `branch_service_tests.rs`
içinde 12 test (listeleme/arşiv filtresi, ad çakışması, son aktif şube
koruması, tenant izolasyonu).

### Desktop

```
npx tsc --noEmit            → temiz
npx vitest run              → 32 dosya / 364 test passed
```

Yeni paket: `tests/integration/branchManagementLockdown.test.ts` (13 test).
Güncellenenler: `ownerManagementAppleHigUi.test.ts` (silinen sekme),
`zeroGapFeatureMatrix.test.ts` (O2 artık patronun **yazamadığını** doğrular).

### Gerçek Chromium (Playwright)

```
branch-management.spec.ts + owner.spec.ts → 11 passed
```

1. MASTER + `feat_multi_branch` kapalı işletme → şube yüzeyi **404** döner.
2. MASTER + bayrak açık işletme → şube eklenir, arşivlenir; arşivli kart
   "Arşiv" rozetine döner ve arşivleme düğmesi pasifleşir.
3. OWNER → patron panelinde "Şubeler" sekmesi yoktur.

### Gerçek ekran görüntüleri

```
docs/evidence/faz6-sube-404-kapali.png
docs/evidence/faz6-master-sube-yonetimi.png
docs/evidence/faz6-patron-sekmesiz.png
```

---

## 4. Statik taramalar

| Tarama | Sonuç |
|---|---|
| Emoji (Faz 6 dosyaları) | 0 |
| `bg-gradient` (Faz 6 dosyaları) | 0 |
| `: any` / `as any` (Faz 6 dosyaları) | 0 |
| Dosya boyutu > 500 satır (Faz 6 dosyaları) | 0 |
| Bileşen boyutu > 300 satır | 0 (`PlatformBranchesPanel` 279 satır; kart, form ve onay yüzeyleri `BranchCard`, `BranchFormModal`, `BranchArchiveDialog` olarak ayrıldı) |
| Prodüksiyon `unwrap()/expect()/panic!` | 0 (yalnız `#[cfg(test)]` modüllerinde) |
| UTF-8 BOM | Faz 6 dosyalarında 0 |

---

## 5. Uydurma veri ve sahte görsel temizliği

- Kaldırılan `OwnerBranchesTab` içindeki sahte sparkline kaldırıldı.
- Şube listesi yalnız backend/mock gerçek kayıtlarından gelir; sayaç, trend veya
  oran uydurması yoktur.
- Tenant alanı artık zorunlu; `DEFAULT_TENANT` sabit fallback'i şube yolunda yok.

---

## 6. Kapsam dışı bırakılan teknik borç

- `cashier/kitchen/manager/waiter/security` Playwright spec'leri eski hızlı giriş
  düğmesini ("1111 Master" gibi) arıyor; Faz 5'ten bu yana bilinen ve Faz 6
  kapsamı dışında kalan borçtur. `owner.spec.ts` ve yeni
  `branch-management.spec.ts` güncel akışı kullanıyor.
- `src/data/local/index.ts` ve `src/domain/entities/index.ts` dosyalarında
  önceden var olan UTF-8 BOM bulunuyor; Faz 6 dosyaları değil, dokunulmadı.
- Platform paneli çok işletmeli (çapraz tenant) toplu işlem sunmaz; MASTER
  tek tek işletme seçip yönetir.

---

## 7. Dosya envanteri

### Yeni
```
desktop/src/presentation/components/layout/BranchSwitcher.tsx
desktop/src/presentation/components/platform/ui/PlatformBranchesPanel.tsx
desktop/src/presentation/components/platform/ui/FeatureDisabledNotice.tsx
desktop/src/presentation/components/platform/ui/BranchFormModal.tsx
desktop/src/presentation/components/platform/ui/BranchArchiveDialog.tsx
desktop/src/presentation/components/platform/ui/BranchCard.tsx
desktop/tests/integration/branchManagementLockdown.test.ts
desktop/tests/e2e-playwright/branch-management.spec.ts
backend/src/services/branch_service.rs
backend/src/services/branch_service_tests.rs
```

### Silinen
```
desktop/src/presentation/components/owner/ui/OwnerBranchesTab.tsx
```

### Değişen
```
backend/src/branch_commands.rs
backend/src/lib.rs
backend/src/services/mod.rs
desktop/src/data/ipc/tauriInvoke.ts
desktop/src/presentation/components/layout/TopHeader.tsx
desktop/src/presentation/components/owner/OwnerDashboardContainer.tsx
desktop/src/presentation/components/platform/PlatformContainer.tsx
desktop/src/presentation/hooks/useFeatureFlags.ts
desktop/src/presentation/store/useAuthStore.ts
desktop/tests/integration/ownerManagementAppleHigUi.test.ts
desktop/tests/integration/zeroGapFeatureMatrix.test.ts
```