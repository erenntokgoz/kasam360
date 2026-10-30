# KASAM360 — Proje Anayasası (v3.0)

> Bu doküman KASAM360 kod tabanında çalışan tüm geliştiriciler ve yapay zeka ajanları için nihai ve bağlayıcı otoritedir. Varsayıma dayalı geliştirme, kanıtsız kural esnetme ve anayasa dışı kod üretimi kesinlikle YASAKTIR.

---

## 1. PROJE KİMLİĞİ VE MİMARİ

- **Tanım:** Restoran, Kafe, Bar ve Benzeri İşletmeler İçin Yerel Öncelikli (Local-First) Yeni Nesil POS & İşletme Yönetim Sistemi (ERP).
- **Temel Prensip:** İnternet kopsa dahi kesintisiz satış, yerel SQLite üzerinde tam veri bütünlüğü, sıfır veri kaybı, milisaniyelik tepki süresi.
- **Dizin Yapısı:**
  - `backend/`: Rust + Tauri 2 + SQLite (sqlx) + Argon2id. Yüksek güvenlikli çekirdek motor ve 247 doğrulanmış IPC komutu.
  - `desktop/`: React 18 + Vite + TypeScript + Tailwind CSS v4 + Zustand + Lucide Icons. Endüstriyel dokunsal mat donanım (Tactile Matte Hardware) tasarım sistemi.
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
- Tüm IPC çağrıları Tauri `generate_handler!` sözleşmesine ve 247 komutluk backend arayüzüne birebir uymak zorundadır.

---

## 4. FRONTEND TASARIM STRATEJİSİ (ENDÜSTRİYEL DOKUNSAL MAT TASARIM SİSTEMİ)

KASAM360 arayüzü; restoran, kafe ve barların yoğun, tempolu ve düşük ışıklı ortamlarında en düşük donanımlı dokunmatik POS terminallerinde dahi 60 FPS çalışan, sıfır gecikmeli, "AI slop" veya cam yansıması içermeyen, Square Register ve Toast POS sağlamlığında Endüstriyel Dokunsal Mat Donanım (Tactile Matte Hardware) estetiğine sahiptir.

### 4.1. Tasarım Felsefesi ve Sıfır Tolerans
- **Sıfır Cam & Sıfır Bulanıklık (No Glassmorphism):** `backdrop-filter`, `backdrop-blur`, yarı saydam cam paneller KESİNLİKLE YASAKTIR. Tüm yüzeyler donanım kasası gibi opaktır.
- **Sıfır AI Slop:** Rastgele parıltı emojileri (✨🚀🔥), anlamsız dalga SVG'leri, süslü karşılama metinleri ("Hoş geldiniz!", "Yapay zeka destekli") KESİNLİKLE YASAKTIR. Ekranlar pazarlama sayfası değil, hassas işletme terminalleridir.
- **Fiziksel Tuş ve Dokunsal Ergonomi:** Kasa ve servis ekranlarında tüm dokunmatik hedefler minimum 48px (`min-h-12`) boyutundadır. Butonlar fiziksel tuş gibi mikro 1px iç ışık ve gölge taşır, tıklandığında `active:translate-y-[1px]` ile mekanik basma hissi verir.
- **Tipografik ve Finansal Netlik:** Tüm tutar, saat, sayaç, stok ve oran değerleri daima `font-variant-numeric: tabular-nums` ile hizalı gösterilir.
- **Donanım Kısayolları (Keyboard Shortcuts):** Hızlı kasiyer ve garson operasyonları için kritik butonlar donanım kısayol rozeti (`<kbd className="kbd-badge">F2</kbd>`) taşır ve global klavye dinleyicisi ile çalışır.

### 4.2. Endüstriyel Renk Paleti (Tactile Matte Palette)
- **Zemin Tabanı (`--bg-base`):** `#090A0C` (Koyu mat şasi)
- **Birincil Yüzey (`--bg-surface`):** `#111317` (Ana ekran kartları ve paneller)
- **Yükseltilmiş Kart / Modal (`--bg-elevated`):** `#171A20` (Yükseltilmiş kontrol yüzeyleri)
- **Etkileşimli / Hover Yüzey (`--bg-interactive`):** `#1E222A` (Aktif/Hover alanları)
- **İnce Sınır (`--border-subtle`):** `#232730` (Ayrım çizgileri)
- **Belirgin Sınır (`--border-strong`):** `#323846` (Vurgulu kenarlıklar)
- **Birincil Metin (`--text-primary`):** `#F3F4F6` (Yüksek kontrast okunabilirlik)
- **İkincil Metin (`--text-secondary`):** `#9CA3AF` (Etiketler ve meta veriler)
- **Üçüncül Metin (`--text-tertiary`):** `#6B7280` (Pasif durumlar)
- **Birincil Aksiyon (`--brand`):** `#2563EB` (Hover: `#3B82F6`)
- **Başarı / Müsait / Hazır (`--success`):** `#10B981`
- **Uyarı / Hazırlanıyor / Rezerve (`--warning`):** `#F59E0B`
- **Tehlike / İptal / 86'd / RUSH (`--danger`):** `#EF4444`
- **Bilgi (`--info`):** `#06B6D4`

### 4.3. Fiziksel Tuş ve Kart Stilleri
```css
/* Fiziksel donanım tuşu standardı */
.tactile-btn {
  border: 1px solid #262A34;
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  transition: background-color 100ms ease, border-color 100ms ease, transform 60ms ease;
}
.tactile-btn:active {
  transform: translateY(1px);
  box-shadow: inset 0 1px 2px 0 rgba(0, 0, 0, 0.6);
}
```

### 4.4. Arayüz Düzeni ve Kabuk (App Shell)
- **İlk Kurulum:** Temiz veritabanında giriş veya kilit ekranı açılmaz; önce `Yeni işletme kur` / `Mevcut işletmeye cihaz bağla` seçimi gelir.
- **Giriş ve PIN Ekranı:** Tam ekran odaklı, 48px+ dokunmatik Numpad tuş takımlı endüstriyel terminal. Yalnız oturum yokken görünür.
- **Kilit Ekranı:** Hareketsizlikte açılır; mevcut oturumu korur ve yalnız oturum sahibinin PIN'iyle kapanır.
- **Operasyon Ekranları:** Solda 72px donanım menü çubuğu (`SidebarNav`), üstte canlı durum çubuğu (`TopStatusBar`), merkezde dinamik modül alanı (`ContentArea`).
- **Modal ve İletişim Pencereleri:** Opak, net kenarlıklı, yüksek kontrastlı yükseltilmiş paneller (`bg-[#171A20]`, `border-[#323846]`).

---

## 5. ROLLER VE YETKİ MATRİSİ (RBAC)

Sistemde tanımlı 6 temel rol bulunmaktadır. Fabrika kullanıcısı veya varsayılan PIN yoktur: temiz cihazda ilk OWNER hesabı kurulum sihirbazında oluşur, PIN'i kullanıcı belirler ve Argon2id ile saklanır. Diğer personeli OWNER tanımlar. Yükseltilen eski kurulumlarda fabrika PIN'i duran hesaplar ilk girişte PIN değiştirmek zorundadır.

| Rol | Yetki Kapsamı |
|---|---|
| **MASTER** | Platform yönetimi, kiracı oluşturma, lisanslama, global feature flag'ler. POS/Kasa/KDS ekranlarına giremez; doğrudan platform paneline yönlendirilir. |
| **OWNER** | İşletme sahibi. Tüm finansal raporlar, P&L, personel maaşları, bütçe ve menü yönetimi. |
| **MANAGER** | Vardiya açma/kapama, iptal ve ikram PIN onayı, masa taşıma/birleştirme, operasyonel raporlar. Maaş tutarlarını göremez. |
| **CASHIER** | Kasa işlemleri, tahsilat, parçalı ödeme, gün sonu raporu, fiş basımı. |
| **WAITER** | Masa düzeni, sipariş alma, mutfağa iletme, adisyon yazdırma. Tahsilat veya iptal yapamaz. |
| **KITCHEN** | Mutfak Ekranı (KDS). Bekleyen siparişleri görme, hazırlama ve teslim durumuna geçirme. |

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
