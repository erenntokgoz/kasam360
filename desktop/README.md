# KASAM360 — Masaüstü İstemci Uygulaması (Desktop)

KASAM360'ın restoran içi satış (POS), mutfak ekranı (KDS), masa planı, kasa istasyonu, patron ve platform yönetici panellerini barındıran masaüstü React + TypeScript sunum katmanıdır.

## Dizin Yapısı & Sorumluluklar

- **`src/`**: Masaüstü uygulama kaynak kodları
  - **`presentation/components/`**: Tüm ekran ve istasyon bileşenleri
    - `auth/`: Kullanıcı giriş ekranı (`LoginPage`), PIN ekranı (`PinScreen`), profil modalı
    - `cashier/`: Kasiyer çalışma istasyonu (`CashierWorkstationContainer`), nakit hareketleri, vardiya yönetimi
    - `endofday/`: Gün sonu kasa kapanışı (`EndOfDayContainer`) ve Z-Raporu özeti
    - `floor/`: Masa planı ve restoran yerleşimi (`FloorPlanContainer`), masa zamanlayıcıları
    - `kds/`: Mutfak ekranı istasyonları (`KdsContainer`), sipariş hazırlama ve tamamlama akışı
    - `management/`: Müdür paneli (`ManagementContainer`), menü, envanter, onaylar ve raporlar
    - `owner/`: Patron yönetim paneli (`OwnerDashboardContainer`), şubeler, satış ve denetim logları
    - `platform/`: Master platform yöneticisi (`PlatformContainer`), işletme açma sihirbazı, vault
    - `pos/`: Sipariş alma terminali (`POSLayout`, `CatalogContainer`, `CartContainer`, `PaymentModalContainer`)
    - `receipts/`: Fiş ve adisyon geçmişi (`ReceiptsContainer`)
    - `layout/`: Masaüstü navigasyon çubuğu (`GlobalNav`), üst başlık (`TopHeader`), uygulama kabuğu (`AppShell`)
    - `common/`: Apple HIG & Spatial Glass ortak tasarım bileşenleri (`AppleButton`, `AppleGlassCard`, `AppleKeypad`, `AppBadge`)
  - **`presentation/store/`**: Global durum yönetimi (Zustand)
    - `useAuthStore.ts`: Oturum, aktif rol, token ve PIN kilidi durumu
    - `useCartStore.ts`: Masa sepeti, ürünler, opsiyonlar ve ara toplamlar
    - `useFloorStore.ts`: Masalar, doluluk durumları ve masa rezervasyonları
  - **`core/`**: Temel UI bileşenleri (shadcn/base-ui), güvenlik tanımları, roller ve yardımcılar
  - **`data/`**: IPC haberleşmesi (`tauriInvoke.ts`), yerel veri depoları, donanım sürücüleri (yazıcı, barkod okuyucu, çekmece, ÖKC)
  - **`domain/`**: İş kuralları, varlıklar (entities), kullanım senaryoları (usecases) ve arayüzler
- **`tests/`**: Kapsamlı entegrasyon, donanım soyutlama ve E2E testleri
- **`index.html`**: Giriş HTML sayfası
- **`vite.config.ts`**: Vite paketleyici ve Vitest yapılandırması
- **`tailwind.config.js`**: Apple HIG & iOS koyu cam (dark glass) tema değişkenleri

## Çalıştırma ve Test
```bash
# Geliştirme sunucusunu başlat
npm run dev

# TypeScript tip kontrolü
npx tsc --noEmit

# Vitest testlerini çalıştır
npm test
```
