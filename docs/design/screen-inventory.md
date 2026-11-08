# Ekran ve bileşen envanteri (taslak, Q01 öncesi)

Durum: **taslak**. Q01 başlangıç kaydı (`docs/acceptance/baseline.md`) henüz yok; bu belge yalnız kaynak koddan salt okunur çıkarıldı. D01 tamamlandı sayılmaz: durum sütunları (yükleniyor/boş/hata/yetkisiz/offline/uzun veri) ekranlar Q01 ortamında açılıp doğrulanınca doldurulacak. Labs (`../360labs/`) bu taslağa dahil değil.

Kaynak: `desktop/src/app/App.tsx`, `desktop/src/lib/roleAccess.ts`, `desktop/src/features/**`, `web/src/app/**`, `web/src/components/**`.

## Desktop — açılış kapıları (sırayla)

| Sıra | Ekran | Bileşen | Koşul |
|---|---|---|---|
| 1 | Kurulum | `setup/SetupGate`, `SetupWizard`, `NewBusinessForm`, `WebAccountForms`, `GoogleSetupButton` | `setupPhase !== COMPLETE` |
| 2 | Hesap girişi | `auth/AccountGate`, `AccountLogin`, `AuthShell`, `GoogleDeviceButton` | cihaz oturumu yok |
| 3 | Lisans | `license/LicenseGate` | lisans kullanılamaz (MASTER hariç) |
| 4 | PIN girişi | `auth/LoginOverlay`, `PinEntry` | personel oturumu yok |
| 5 | PIN değiştirme zorunlu | `auth/MustChangePinModal` | fabrika PIN'li eski hesap |
| 6 | Platform hesabı engeli | `App.tsx` içi kart | rol operasyon açamaz (MASTER) |
| — | Kilit | `auth/LockScreen` | hareketsizlik; içerik `inert` |
| — | Belirsiz durum | `aria-busy` boş yüzey | cihaz/lisans durumu okunuyor |

Not: 2. ve 3. kapıda "yükleniyor" durumu şu an boş tuvaldir; tasarlanmış bir yükleniyor ekranı yok.

## Desktop — modüller, rol ve kısayol

| Modül | Kısayol | Roller | Alt sekmeler | Ana bileşenler |
|---|---|---|---|---|
| FLOOR Salon | F1 | MASTER, OWNER, MANAGER, CASHIER, WAITER | — | `FloorModule`, `FloorBlueprint`, `TableCardGrid`, `TableSlideOver` (drawer) |
| POS | F2 | MASTER, OWNER, MANAGER, CASHIER, WAITER | — | `PosModule`, `ProductCatalog`, `OrderTicket`, `OrderStatusBanner` |
| KDS | F3 | MASTER, OWNER, MANAGER, WAITER, KITCHEN | — | `KdsModule` |
| CASHIER Kasa | F4 | MASTER, OWNER, MANAGER, CASHIER | Defter (adı değişecek), Fişler, Gün Sonu; eylem: Nakit Giriş, Nakit Çıkış, Gider Öde | `CashierModule`, `ShiftMovements`, `ShiftHistory`, `ReceiptsTab`, `OrderChangeRequests` |
| ERP Yönetim | F5 | MASTER, OWNER, MANAGER | Genel Bakış, Cari (Müşteriler/Tedarikçiler), Personel, Kritik Kayıtlar; Kasa'dan yönlenen Finans | `PanoramaTab` + `panorama/*`, `DebtsTab`, `Cari*`, `staff/*`, `payroll/*`, `CriticalLogTab`, `finance/*`, `reports/ReportsTab` |
| CATALOG Menü ve Stok | — (kısayol yok) | MASTER, OWNER, MANAGER | Menü kataloğu; Stok: Mevcut Stok, Reçeteler, Zayiat ve Fire, Hareketler | `CatalogTab`, `menu/*`, `stock/*` |
| SETTINGS | F6 | MASTER, OWNER, MANAGER | Bu Cihaz, Salon ve Mutfak, Yedek ve Kurtarma, Oturum ve Görünüm, Cihaz Bağlantıları, Masalar ve Kroki, Mutfak İstasyonları, Rezervasyon | `settings/*`, `BackupPanel`, `SessionSettingsTab`, `QrMenuPanel`, `TipPoolPanel` |

Açık soru: CATALOG için kısayol tanımsız (sahipsiz değil ama tutarsız). F-kısayolları kilit, PIN değişimi ve operasyon dışı rolde kapalı.

## Desktop — modal, drawer ve diyaloglar

| Grup | Bileşenler |
|---|---|
| Global | `ShiftGateModal`, `PaymentModal` (Tam Hesap / Kaleme Göre / Tutara Göre; test POS sonuçları), `ReceiptPreviewModal`, `MustChangePinModal`, `LockScreen` |
| Ödeme | `ManagerPinPrompt`, `TipDialog`, `PaymentChannelSection`, `PaymentItemSplitTab` |
| POS | `ModifierModal`, `ItemTransferModal`, `SmartAuthModal` |
| Salon | `GuestPickerModal`, `ReservationModal`, `TableSlideOver` |
| Kasa | `BlindCloseModal`, `RefundModal`, `ChangeRequestModal`, `CashMovementForm`, `CashExpenseForm` |
| Cari | `CariCardModal`, `CariOpenDebtModal`, `CariEditDebtModal`, `CariPaymentModal` |
| Personel | `StaffFormModal`, `AdvanceForm`, `RuleEditor` |
| Menü | `MenuCategoryModal`, `MenuModifierModal`, `TariffFormModal` |
| Stok | `StockEntryModal`, `StockItemEditor` |
| Ayarlar | `AddTablesModal`, `KrokiEditor` |
| Ortak UI | `ui/Modal`, `Drawer`, `ConfirmDialog`, `PinpadModal`, `Numpad`, `NumberInput`, `ErrorToast`, `OperationNotice` |

## Web — rotalar

| Rota | Amaç | Bileşen |
|---|---|---|
| `/` | Tanıtım | `page.tsx`, `sheets/*` |
| `/ozellikler` | Özellikler | |
| `/abonelik` | Paketler | |
| `/sorular` | SSS | |
| `/iletisim`, `/destek` | İletişim, destek | `account/SupportPanel` |
| `/giris`, `/kayit` | Hesap | `account/LoginForm`, `RegisterForm` |
| `/sifremi-unuttum`, `/sifre-yenile` | Parola | `account/PasswordForms` |
| `/hesabim` | Müşteri portalı | `account/AccountPanel` |
| `/gizlilik`, `/kullanim-sartlari`, `/kvkk`, `/iade` | Hukuki | `LegalPage` |
| 404 | Bulunamadı | `not-found.tsx` |

Eksik (web planına göre beklenen, rotası yok): ödeme/checkout dönüşü, cihaz yönetimi, işletme seçimi. Bunlar backend kontratına bağlı; sahte akışla doldurulmayacak.

## Kaldırılacak eski tema (yalnız görsel)

- Desktop: `notebook.css`, `paper`/`sheet-*`/`pen-red`/`ink` sınıfları (~75 `paper` kullanımı), Kasa sekmesi adı "Defter".
- Web: `pad.css`, `PadStack`, `PageSheet`, `SheetHead`, `components/sheets/*` (`BackBoardSheet`, `MoneySheet`, `OrderSheet`, `OutageSheet`, `TicketSheet`).
- Korunacak: bu bileşenlerin taşıdığı iş davranışı (IPC çağrıları, rol kontrolleri, fail-closed kapılar). Görsel değişiklik bunlara dokunmaz.

## Durum matrisi

Q01 test ortamı hazır olunca her satır için normal / yükleniyor / boş / doğrulama hatası / sunucu hatası / yetkisiz / offline / uzun veri durumları gerçek ekranda işaretlenecek.
