# KASAM360 — Proje Anayasası (v3.0)

> Bu doküman KASAM360 kod tabanında çalışan tüm geliştiriciler ve yapay zeka ajanları için nihai ve bağlayıcı otoritedir. Varsayıma dayalı geliştirme, kanıtsız kural esnetme ve anayasa dışı kod üretimi kesinlikle YASAKTIR.

---

## 1. PROJE KİMLİĞİ VE MİMARİ

- **Tanım:** Restoran, Kafe, Bar ve Benzeri İşletmeler İçin Yerel Öncelikli (Local-First) Yeni Nesil POS & İşletme Yönetim Sistemi (ERP).
- **Temel Prensip:** İnternet kopsa dahi kesintisiz satış, yerel SQLite üzerinde tam veri bütünlüğü, sıfır veri kaybı, milisaniyelik tepki süresi.
- **Dizin Yapısı:**
  - `backend/`: Rust + Tauri 2 + SQLite (sqlx) + Argon2id. Yüksek güvenlikli çekirdek motor ve 189 doğrulanmış IPC komutu.
  - `desktop/`: React 18 + Vite + TypeScript + Tailwind CSS v4 + Zustand + Lucide Icons. Yeni nesil akıcı cam (Clean Glass) tasarım sistemi.
  - `docs/`: Mimari ve güvenlik şartnameleri (`security-audit.md`, `offline-conflict-policy.md`).

---

## 2. DEĞİŞTİRİLEMEZ TEMEL İLKELER (SOURCE OF TRUTH)

1. **Finansal Kesinlik (INTEGER Cents):**
   - Tüm para tutarları veri tabanında, servislerde ve IPC kontratlarında tamsayı kuruş (`*_cents`, `INTEGER`) olarak saklanır ve işlenir.
   - Finansal hesaplamalarda `f32` / `f64` (float) kullanımı KESİNLİKLE YASAKTIR.
   - Arayüzde kuruş, `formatMoney(cents)` yordamı ile yerelleştirilmiş para formatına ("1.250,50 TL") çevrilerek gösterilir.

2. **Finansal Sessiz Hata Yasağı (Fail-Closed):**
   - Finansal toplamlarda ve bakiye sorgularında `unwrap_or(0)`, `unwrap_or_default()`, `unwrap_or_else(|| 0)` kullanımı YASAKTIR.
   - Bir sorgu veya hesaplama hata verirse sistem bunu sıfır kabul edip sessizce yutamaz; hata yukarı taşınmalı (`?`) ve işlem reddedilmelidir.

3. **Kimlik Güvenliği (Argon2id PHC):**
   - Tüm kullanıcı parolaları ve PIN kodları Argon2id PHC özeti olarak saklanır. Düz metin (plaintext) şifre saklamak, loglamak veya IPC ile döndürmek KESİNLİKLE YASAKTIR.

4. **Kayıt ve Denetim Bütünlüğü (Audit Ledger):**
   - `audit_ledger` tablosu SHA-256 zinciriyle mühürlenmiş eklemeli (append-only) bir finansal ve operasyonel kayıt defteridir.
   - `audit_ledger` üzerinde `UPDATE` ve `DELETE` çalıştırmak kesinlikle YASAKTIR (DB seviyesinde tetikleyici ile kilitlidir).

5. **Gerçek FIFO Stok Takibi:**
   - Stok maliyetlendirmesi `inventory_batches` tablosundaki gerçek parti/lot girişleri üzerinden ilk-giren-ilk-çıkar (FIFO) ile yapılır. Sahte tahmini oranlar kullanılamaz.

6. **Ön Ekli ULID Kimlikleri:**
   - Tüm birincil anahtarlar sıralı ve ön ekli ULID formatındadır (`ord_...`, `txn_...`, `usr_...`, `tbl_...`, `bat_...`). Sayısal AUTOINCREMENT kimlikler kullanılmaz.

7. **Tam Kiracı Yalıtımı (Multi-Tenant Isolation):**
   - Çok kiracılı mimaride her veritabanı sorgusu mutlaka `tenant_id` filtresi taşımak zorundadır. Kiracısız (`tenant_id` içermeyen) SELECT, UPDATE, DELETE sorguları YASAKTIR.

---

## 3. KOD YAZIM STANDARTLARI VE İSİMLENDİRME

### 3.1. Dosya İsimlendirme Kuralları
- **Rust Kaynak Dosyaları:** Kesinlikle küçük harf ve alt çizgi (`snake_case.rs`). Örneğin: `inventory_migration.rs`, `floor_plan_commands.rs`.
- **React Bileşenleri:** Kesinlikle PascalCase (`PascalCase.tsx`). Örneğin: `PaymentModal.tsx`, `SidebarNav.tsx`.
- **TypeScript Modülleri ve Yardımcılar:** Kesinlikle camelCase (`camelCase.ts`). Örneğin: `formatMoney.ts`, `authStore.ts`.
- **Dokümantasyon:** Küçük harf ve tire (`kebab-case.md`).
- **Yasaklı İsimler:** Dosya veya klasör adlarında aşama numaraları, gereksiz kod adları veya marka isimleri kullanılamaz.

### 3.2. Dil ve Yorum Standartları
- **Kod Tanımlayıcıları:** Fonksiyon, değişken, tip, enum ve struct adları evrensel standart gereği İngilizce yazılır (`processPayment`, `calculateTotalCents`, `OrderState`).
- **Kod Yorumları ve Dokümantasyon:** Tüm yorum satırları, modül başlıkları ve docstring'ler Türkçe yazılır. Yorumlar kodun "ne" yaptığını değil, "neden" o kararın verildiğini ve güvenlik gerekçelerini açıklar.
- **Karakter Kodlaması:** Tüm dosyalar UTF-8 (BOM'suz) formatında tutulur.

### 3.3. Kod Kalitesi ve Güvenlik Sınırları
- Prodüksiyon backend kodunda `panic!`, `unwrap()`, `expect()`, `todo!()` YASAKTIR.
- Frontend TypeScript kodunda `any` tipi kullanımı YASAKTIR.
- Dosya boyutu limiti 500 satırdır; aşan dosyalar mantıksal alt modüllere bölünür.
- Tüm IPC çağrıları Tauri `generate_handler!` sözleşmesine ve 189 komutluk backend arayüzüne birebir uymak zorundadır.

---

## 4. FRONTEND TASARIM STRATEJİSİ (CLEAN GLASS DESIGN SYSTEM)

KASAM360 arayüzü; restoran, kafe ve barların yoğun, tempolu ve düşük ışıklı ortamlarında gözü yormayan, hata payını sıfıra indiren, derinlikli ve akıcı bir görsel dille tasarlanmıştır.

### 4.1. Tasarım Felsefesi
- **Derinlik ve Saydamlık:** Arayüz katmanları havada asılı duran zarif cam yüzeyler (Floating Glass) olarak modellenir.
- **Sıfır AI Slop:** Rastgele parıltı emojileri (✨🚀🔥), anlamsız dalga SVG'leri, klişe karşılama metinleri ("Hoş geldiniz!", "Yapay zeka ile güçlendirildi") KESİNLİKLE YASAKTIR.
- **Dokunsal Ergonomi:** Kasa ve servis ekranlarında dokunmatik hedefler minimum 48px boyutunda, butonlar net tıklama hissi veren geri bildirimle donatılmıştır.
- **Tipografik Netlik:** Rakamlar ve tutarlar her zaman `font-variant-numeric: tabular-nums` ile hizalı gösterilir.

### 4.2. Renk Paleti

#### Koyu Tema (Dark Mode - Varsayılan)
- **Zemin Tabanı (bg-base):** `#0B0C0E`
- **Yüzey Katmanı (bg-surface):** `#16171A`
- **Yükseltilmiş Yüzey (bg-elevated):** `#1F2024`
- **Sınır Çizgileri (border):** `#26272B`
- **Belirgin Sınır (border-strong):** `#34353A`
- **Birincil Metin (text-primary):** `#F5F5F7`
- **İkincil Metin (text-secondary):** `rgba(245, 245, 247, 0.64)`
- **Üçüncül Metin (text-tertiary):** `rgba(245, 245, 247, 0.40)`
- **Vurgu / Marka (brand):** `#0A84FF`
- **Vurgu Hover:** `#409CFF`
- **Başarı (success):** `#30D158`
- **Uyarı (warning):** `#FF9F0A`
- **Tehlike (danger):** `#FF453A`
- **Bilgi (info):** `#64D2FF`

#### Açık Tema (Light Mode)
- **Zemin Tabanı (bg-base):** `#FAFAFA`
- **Yüzey Katmanı (bg-surface):** `#FFFFFF`
- **Yükseltilmiş Yüzey (bg-elevated):** `#F5F5F7`
- **Sınır Çizgileri (border):** `#E5E5EA`
- **Belirgin Sınır (border-strong):** `#D1D1D6`
- **Birincil Metin (text-primary):** `#0A0B0F`
- **İkincil Metin (text-secondary):** `rgba(10, 11, 15, 0.64)`
- **Vurgu / Marka (brand):** `#007AFF`
- **Başarı (success):** `#34C759`
- **Uyarı (warning):** `#FF9500`
- **Tehlike (danger):** `#FF3B30`

### 4.3. Cam Malzeme Fiziği (Glass Spec)
```css
/* Çok katmanlı cam zemin standardı */
.glass-surface {
  background: rgba(22, 23, 26, 0.68);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.16);
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.10),
    inset 0 -1px 0 0 rgba(0, 0, 0, 0.20),
    0 20px 40px -15px rgba(0, 0, 0, 0.5);
}
```

### 4.4. Arayüz Düzeni ve Kabuk (App Shell)
- **Giriş ve PIN Ekranı:** Tam ekran odaklı, gereksiz navigasyon barı içermeyen temiz cam panel.
- **Operasyon Ekranları:** Solda yüzen ikon/menü çubuğu (`FloatingSidebar`, 72px), üstte durum ve bildirim alanı (`FloatingTopBar`), merkezde dinamik modül alanı (`ContentArea`).
- **Modal ve İletişim Pencereleri:** Yüksek bulanıklıklı cam arka plan (`backdrop-blur-xl`), yumuşak yaylanma animasyonu.

---

## 5. ROLLER VE YETKİ MATRİSİ (RBAC)

Sistemde tanımlı 6 temel rol bulunmaktadır:

| Rol | Varsayılan PIN | Yetki Kapsamı |
|---|---|---|
| **MASTER** | `1111` | Platform yönetimi, kiracı oluşturma, lisanslama, global feature flag'ler. POS/Kasa/KDS ekranlarına giremez; doğrudan platform paneline yönlendirilir. |
| **OWNER** | `2222` | İşletme sahibi. Tüm finansal raporlar, P&L, personel maaşları, bütçe ve menü yönetimi. |
| **MANAGER** | `3333` | Vardiya açma/kapama, iptal ve ikram PIN onayı, masa taşıma/birleştirme, operasyonel raporlar. Maaş tutarlarını göremez. |
| **CASHIER** | `4444` | Kasa işlemleri, tahsilat, parçalı ödeme, gün sonu raporu, fiş basımı. |
| **WAITER** | `5555` | Masa düzeni, sipariş alma, mutfağa iletme, adisyon yazdırma. Tahsilat veya iptal yapamaz. |
| **KITCHEN** | `6666` | Mutfak Ekranı (KDS). Bekleyen siparişleri görme, hazırlama ve teslim durumuna geçirme. |

---

## 6. ÖZELLİK BAYRAKLARI (FEATURE FLAGS)

Sistemde tanımlı 11 özellik bayrağı bulunur. Bayrak kapalıysa ilgili arayüz rotası açılmaz, doğrudan 404/Erişim Engellendi durumuna düşer (fail-closed):

- `feat_kds`: Açık (Mutfak Ekranı Modülü)
- `feat_qr_menu`: Açık (Dış Müşteri Menü Dosyası ve Sipariş)
- `feat_delivery`: Kapalı (Paket Servis Entegrasyonu)
- `feat_caller_id`: Kapalı (Arayan Numara Gösterme)
- `feat_table_order`: Açık (Masa Bazlı Sipariş Yönetimi)
- `feat_seat_split`: Kapalı (Sandalye Bazlı Hesap Bölme)
- `feat_recipe_bom`: Açık (Reçete ve Stok Düşüm Maliyeti)
- `feat_dynamic_pricing`: Kapalı (Dinamik Fiyatlandırma ve Zaman Kuralları)
- `feat_ledger_cari`: Açık (Hesap Defteri, Tedarikçi ve Cari Bakiye)
- `feat_multi_branch`: Kapalı (Çoklu Şube Yönetimi)
- `feat_loss_radar`: Açık (Fire, Şüpheli İşlem ve İptal Radarı)

---

## 7. KRİTİK GÜVENLİK VE BÜTÜNLÜK KİLİTLERİ

1. **FIFO Maliyet Kilidi:** Sahte stok formülü yasaktır; her kalem `inventory_batches` üzerinden gerçek maliyetle eşleşir.
2. **Çift Stok Düşümü Koruması:** Parçalı tahsilatta stok yalnızca sipariş anında veya ilk kapanışta bir kez düşülür; her ödeme adımında tekrar düşülemez.
3. **Kasa Kart/Nakit Ayrımı:** Kasa kapatmada nakit ve kart toplamları ayrı tutulur, açığın hangi kanaldan olduğu şeffafça denetlenir.
4. **Muteks Ayrımı:** Finansal ödeme işlemleri (`payment_mutex`) ile denetim defteri yazımları (`audit_mutex`) birbirinden bağımsız kilit mekanizmalarına sahiptir.
5. **Fiyat Kayması Koruması:** Sipariş anındaki birim fiyat ve KDV oranı kaleme mühürlenir (`frozen_unit_price_cents`); menüde sonradan yapılan zam açık siparişi etkilemez.
6. **Kaba Kuvvet Giriş Kilidi:** 5 kez hatalı PIN girildiğinde cihaz/kullanıcı bazında geçici süreyle kilitlenir.
7. **Çapraz Kiracı PIN Engeli:** Başka bir kiracının PIN kodu ile oturum açılamaz.
8. **Ödenmiş Sipariş İptal Yasağı:** `PAID` veya `CLOSED` durumundaki bir sipariş iptal edilemez; iade işlemi iade akışı üzerinden yürütülür.
9. **Negatif Fiyat Engeli:** Ürün opsiyonları ve ekleri negatif fiyat taşıyamaz (indirim kalemleri hariç).

---

## 8. TEST VE DOĞRULAMA PROTOKOLÜ

Her kod değişikliğinden sonra aşağıdaki doğrulama adımları eksiksiz geçilmek zorundadır:

1. **Backend Doğrulaması:**
   ```powershell
   cargo clippy --lib --tests -- -D warnings   # Sıfır hata, sıfır uyarı
   cargo test --lib                          # 964 testin tamamı başarılı (100% pass)
   cargo fmt --check                         # Standart Rust formatı
   ```

2. **Frontend Doğrulaması:**
   ```powershell
   npm run build                             # TypeScript derlemesi sıfır hata
   ```

3. **Kod Hijyeni Taramaları:**
   - Kod tabanında hiçbir yerde harici marka adı, aşama numarası veya geçici geliştirme etiketi yer alamaz.
   - UI kodunda kontrolsüz emoji veya ham Tailwind gradient kullanımı olamaz.
