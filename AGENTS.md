# KASAM360 — AGENTS.md (Proje Anayasası v2.0)

> Bu doküman KASAM360 reposunda çalışan tüm AI agent'lar için en üst otoritedir. Uydurma, varsayım, kanıtsız kural değişikliği YASAK.

---

## 1. PROJE KİMLİĞİ

- KASAM360: Restoran/Kafe/Bar için Local-First POS + ERP
- Repo: github.com/erenntokgoz/kasam360
- Yapı: desktop/ (React+Vite+TS) + backend/ (Tauri+Rust+SQLite) + mobile/ (boş)
- Vizyon: "En salak kullanıcı 10 saniyede öğrenir; motor Toast/Micros'u ezer."

---

## 2. SOURCE OF TRUTH (Değiştirilemez)

- Para: Tüm tutarlar INTEGER kuruş (*_cents). Float YASAK.
- Kimlik: Argon2id PHC hash. Düz metin YASAK.
- FIFO: inventory_batches üzerinden gerçek parti/lot. Sahte %35 formülü YASAK.
- Audit: audit_ledger SHA-256 zinciri. UPDATE/DELETE YASAK.
- ID: Prefixed ULID (ord_, txn_, dir_, usr_). AUTOINCREMENT YASAK.
- Multi-tenant: Her sorguda tenant_id ZORUNLU.

---

## 3. KESİN YASAKLAR

### 3.1. Kod
- Prodüksiyonda panic!, unwrap(), expect(), todo!() YASAK
- TypeScript'te any YASAK
- Filtresiz SQL YASAK
- audit_ledger UPDATE/DELETE YASAK
- main.rs'te mükerrer IPC YASAK (kasam360_core::run() delegasyonu)
- Google Cloud / harici bulut YASAK
- Donanım çağrıları blocking YASAK (async kuyruk + 2sn timeout)

### 3.2. UI (AI Slop)
- Emoji UI'da YASAK (✨🚀🔥⭐💡🎯👋💪🧠🪄)
- Klişe copy YASAK ("Hoş geldin", "Muhteşem", "Oops", "Powered by AI")
- Gradient YASAK (primary buton hariç: dikey 180°, marka rengi açık→koyu)
- Undraw/Storyset/Popsy illüstrasyon YASAK
- Fake sparkline / anlamsız SVG wave YASAK
- Ham SHA-256 hash UI'da YASAK (log içinde, "🛡️ Mühürlü" rozeti)
- Karışık ikon kütüphanesi YASAK (sadece Lucide + Phosphor)
- Ham Tailwind ekranlarda YASAK (design system)
- Beyaz zemin + siyah yazı YASAK (glass olacak)
- Turuncu buton YASAK
- İngilizce metin YASAK (kod değişkenleri hariç)

### 3.3. Mimari
- tenant_id filtresiz sorgu YASAK
- Cross-tenant veri sızıntısı YASAK
- Feature flag kapalıyken route açık YASAK (404 dönmeli)

---

## 4. LIQUID GLASS / APPLE HIG ANAYASASI

### 4.1. Felsefe
- Referans: Apple iOS 27 + macOS 27 + visionOS
- "Her şey havada yüzer" (sidebar, topbar, kart, modal — min 16px boşluk)
- AI slop sıfır tolerans

### 4.2. Renk Paleti (Apple System Colors — oturaklı, doygun değil)

Dark Mode:
bg-base:      #0B0C0E
bg-surface:   #16171A
bg-elevated:  #1F2024
border:       #26272B
border-strong:#34353A

text-primary:   #F5F5F7
text-secondary: rgba(245, 245, 247, 0.64)
text-tertiary:  rgba(245, 245, 247, 0.40)
text-quaternary:rgba(245, 245, 247, 0.24)

brand:        #0A84FF
brand-hover:  #409CFF

success:      #30D158
warning:      #FF9F0A
danger:       #FF453A
info:         #64D2FF
purple:       #BF5AF2
pink:         #FF375F
yellow:       #FFD60A

Light Mode:
bg-base:      #FAFAFA
bg-surface:   #FFFFFF
bg-elevated:  #F5F5F7
border:       #E5E5EA
border-strong:#D1D1D6

text-primary:   #0A0B0F
text-secondary: rgba(10, 11, 15, 0.64)
text-tertiary:  rgba(10, 11, 15, 0.40)
text-quaternary:rgba(10, 11, 15, 0.24)

brand:        #007AFF
brand-hover:  #0066CC

success:      #34C759
warning:      #FF9500
danger:       #FF3B30
info:         #32ADE6
purple:       #AF52DE
pink:         #FF2D55
yellow:       #FFCC00

Kural: Bu değerlerin dışında renk YASAK. Yeni renk gerekirse önce AGENTS.md güncellenir.

### 4.3. Glass Katmanları (5 seviye)

Dark Mode:
--glass-thin:    rgba(255, 255, 255, 0.03);
--glass-regular: rgba(255, 255, 255, 0.05);
--glass-thick:   rgba(255, 255, 255, 0.08);
--glass-heavy:   rgba(22, 23, 26, 0.68);
--glass-ultra:   rgba(31, 32, 36, 0.85);

Light Mode:
--glass-thin:    rgba(255, 255, 255, 0.40);
--glass-regular: rgba(255, 255, 255, 0.60);
--glass-thick:   rgba(255, 255, 255, 0.75);
--glass-heavy:   rgba(255, 255, 255, 0.85);
--glass-ultra:   rgba(255, 255, 255, 0.92);

### 4.4. Cam Fiziği (ZORUNLU)

backdrop-filter: blur(40px) saturate(180%);
-webkit-backdrop-filter: blur(40px) saturate(180%);

border: 1px solid var(--border);
border-top-color: rgba(255, 255, 255, 0.14);

box-shadow:
  inset 0 1px 0 0 rgba(255, 255, 255, 0.10),
  inset 0 -1px 0 0 rgba(0, 0, 0, 0.20),
  0 20px 60px -10px rgba(0, 0, 0, 0.45),
  0 0 0 1px rgba(0, 0, 0, 0.35);

### 4.5. Ambiyans (Arka Plan)

Zemin düz olamaz. Her ekranın arkasında 2 radyal blob olmalı:

Dark:
body {
  background: var(--bg-base);
  background-image:
    radial-gradient(ellipse 80% 60% at 15% 0%,
      rgba(10, 132, 255, 0.08), transparent 60%),
    radial-gradient(ellipse 60% 50% at 100% 100%,
      rgba(191, 90, 242, 0.06), transparent 60%);
}

Light:
body {
  background: var(--bg-base);
  background-image:
    radial-gradient(ellipse 80% 60% at 15% 0%,
      rgba(0, 122, 255, 0.05), transparent 60%),
    radial-gradient(ellipse 60% 50% at 100% 100%,
      rgba(175, 82, 222, 0.04), transparent 60%);
}

Kural: Ambiyans olmadan cam görünmez. Blob'lar zorunlu.

### 4.6. Tokenlar

- Radius: sadece 4, 8, 12, 16, 20, 24 (başka değer YASAK)
- Gölge: 4 seviye (shadow-sm, shadow-md, shadow-lg, shadow-xl)
- Font: SF Pro / Inter Tight, sadece 400, 500, 600 (700 YASAK)
- Font boyutları:
  text-title-1: 28px / 600 / -0.02em
  text-title-2: 22px / 600 / -0.01em
  text-headline: 17px / 600 / -0.02em
  text-body: 17px / 400 / -0.01em
  text-callout: 16px / 400 / 0
  text-subheadline: 15px / 400 / 0
  text-footnote: 13px / 400 / 0
  text-caption-1: 12px / 400 / 0
  text-caption-2: 11px / 500 / 0.01em
- Animasyon: 100, 150, 250, 400ms — 2 easing:
  cubic-bezier(0.32, 0.72, 0, 1) (default)
  cubic-bezier(0.4, 0, 0.2, 1) (snappy)
- İkon: Lucide + Phosphor, 1.5px stroke
- Sayılar: font-variant-numeric: tabular-nums (fiyat, KDV, toplam)

### 4.7. Dark + Light Mode

Her ekran ikisini de destekler. "Dark yeter" YASAK. Tema toggle üst sağda. Sistem tercihi varsayılan.

### 4.8. Sayfa Yapısı

- Login + PIN: Tam ekran (sidebar yok)
- Diğer tüm ekranlar: FloatingSidebar (72px, 16px havada) + FloatingTopBar (16px havada) + ContentArea
- Modal: GlassModal (backdrop-blur 60px, ultra seviye)

---

## 5. KLASÖR YAPISI

kasam360/
├── AGENTS.md
├── packages/contracts/              Rust→TS tip üretimi (ts-rs)
├── desktop/
│   ├── src/
│   │   ├── design-system/
│   │   │   ├── tokens/              colors, spacing, radius, shadows, motion, typography
│   │   │   ├── primitives/          Box, Text, Icon, Stack, Inline
│   │   │   ├── surfaces/            GlassSurface, FloatingSidebar, FloatingTopBar, GlassModal
│   │   │   ├── buttons/             Primary, Secondary, Ghost, Danger
│   │   │   ├── inputs/              GlassInput, GlassSelect, GlassTextarea
│   │   │   ├── feedback/            DynamicIslandToast, GlassTooltip, LoadingDots
│   │   │   └── layout/              AppShell, ContentArea, PageContainer
│   │   ├── screens/                 auth, pos, floor, kds, cashier, ledger, staff, menu, reports, owner, platform, settings
│   │   ├── stores/                  Zustand (auth, cart, floor, cashier)
│   │   ├── services/                soundService, printService, hardwareService, featureFlagService
│   │   └── tests/emulators/         Fiziki POS/ÖKC simülatörü (İZOLE — prod kodunu kirletmez)
├── backend/src/                     commands, services, repositories, domain, id_generator.rs
├── backend/migrations/schema.sql
└── mobile/                          boş (.gitkeep)

---

## 6. ROLLER VE YETKİ SINIRLARI

Rol        Kod    Yetki
MASTER     1111   Platform, tenant, feature flags, şube
OWNER      2222   İşletme sahibi, tüm işlemler
MANAGER    3333   Vardiya, onay, kısmi rapor
CASHIER    4444   Kasa, ödeme, vardiya
WAITER     5555   Masa, sipariş
KITCHEN    6666   KDS, mutfak

- MASTER POS/Floor/KDS rotalarına giremez (PlatformScreen'e zorunlu yönlendirme)
- Void/indirim/ikram → anlık PIN modalı (sekme değil)
- Şube ekle/sil → sadece MASTER
- Patron panelinde "Şubeler" sekmesi YOK (sadece geçiş dropdown)
- Personel soft-delete (silme YASAK, pasife alınır)

---

## 7. TEST PROTOKOLÜ (Her PR)

cd backend && cargo check         # 0 hata, 0 uyarı
cd backend && cargo test          # 100% pass
cd desktop && npx tsc --noEmit    # 0 hata
cd desktop && npx vitest run      # 100% pass

Ek taramalar:
grep -rP "[\x{1F300}-\x{1F9FF}]" desktop/src/   # Emoji → 0
grep -rE "bg-gradient" desktop/src/              # Gradient → 0
grep -rn "unwrap()\|expect(" backend/src/        # Prodüksiyon → 0
grep -rn "tenant_id" backend/src/ | wc -l        # Her sorguda olmalı

Bir kapı geçilmeden sonraki faza GEÇİLMEZ.

---

## 8. FEATURE FLAGS (11 Adet)

feat_kds              AÇIK
feat_qr_menu          AÇIK
feat_delivery         KAPALI
feat_caller_id        KAPALI
feat_table_order      AÇIK
feat_seat_split       AÇIK
feat_recipe_bom       AÇIK
feat_dynamic_pricing  KAPALI
feat_ledger_cari      AÇIK
feat_multi_branch     KAPALI
feat_loss_radar       AÇIK

Override zinciri: tenant → branch (user override YOK). Kapalıysa route 404.

---

## 9. 13 P0 GÜVENLİK KİLİDİ

1. Sahte FIFO kaldır → gerçek parti/lot
2. Parçalı ödemede çift stok düşümü engeli
3. close_day açık sıfırlama sabotajı kaldır
4. Kasa kart/nakit ayrımı
5. KDS O(N) event taraması fix
6. audit_mutex + payment_mutex ayrımı
7. Fiyat kayması dondurma
8. Parçalı ödeme bakiye formülü düzelt
9. Cross-tenant PIN fallthrough kapat
10. caller_role oturum doğrulaması
11. void_order PAID/CLOSED yasak
12. Negatif modifier fiyat engeli
13. 5 hatalı PIN + busy_timeout(5000)

---

## 10. KOD YAZIM KURALLARI

- Yorumlar Türkçe (neden yapıldığı)
- Identifiers İngilizce (mevcut convention)
- Dosya boyutu: max 500 satır (aşarsa modüllere böl)
- Bileşen boyutu: max 300 satır
- Dosyalar UTF-8 (BOM'suz)
- displayName + forwardRef her custom bileşende
- Türkçe karakterler doğru kodlanacak (ı, ş, ğ, ü, ö, ç)
- Yorum satırı "neden" der, "ne" demez.

---

## 11. AGENT ÇALIŞMA PROTOKOLÜ

BEFORE CHANGE:
- AGENTS.md ve ilgili domain kurallarını oku
- Baseline: npx tsc --noEmit çalıştır

DURING CHANGE:
- Sadece istenen değişikliği yap
- Kod yorumlarını Türkçe yaz
- Yetki matrisini ihlal etme

AFTER CHANGE:
- Typecheck + cargo check + vitest çalıştır
- Kanıt göster (konsol çıktısı)
- AI slop taraması yap

KANIT ZORUNLULUĞU:
- Screenshot: Gerçek Chrome çıktısı (Gemini mockup YASAK)
- Kod içeriği: Tam metin ("şu dizinde" YASAK)
- Test çıktısı: PASS gösterilmesi
- Her batch sonunda DUR, onay bekle
- Batch onaylanmadan sonraki batch'e GEÇİLMEZ

EKSİK İŞ YAPMA:
- Agent verilen listedeki her maddeyi birebir uygular
- "Yakın", "benzer", "yeterli" gibi ifadeler YASAK
- Liste dışına çıkma, liste içinde kal
- Emin değilsen DUR ve sor

---

## 12. ÖZET — "YAPMA" LİSTESİ

- Emoji, gradient, jargon
- panic!, unwrap(), any
- Filtresiz SQL, cross-tenant
- Sahte FIFO, hash UI'da
- Ham Tailwind, karışık ikon
- İngilizce metin
- "Dark yeter" (light da olacak)
- Gemini mockup (gerçek Chrome)
- "Şu dizinde" (tam içerik)
- Batch atlama (her batch onay sonrası)
- Liste dışına çıkma, madde atlama
- #3B82F6 gibi generic AI mavisi (Apple #0A84FF kullan)
- Saf siyah #000 / saf beyaz #FFF (sıcak tonlar kullan)
- Neon/doygun renkler (Apple system colors kullan)

