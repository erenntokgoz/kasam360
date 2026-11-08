# KASAM360 — Proje Anayasası (v4.0)

> Bu doküman KASAM360 kod tabanında çalışan tüm geliştiriciler ve yapay zeka ajanları için nihai ve bağlayıcı otoritedir. Varsayıma dayalı geliştirme, kanıtsız kural esnetme ve anayasa dışı kod üretimi kesinlikle YASAKTIR.

---

## 1. PROJE KİMLİĞİ VE MİMARİ

- **Tanım:** Restoran, Kafe, Bar ve Benzeri İşletmeler İçin Yerel Öncelikli (Local-First) Yeni Nesil POS & İşletme Yönetim Sistemi (ERP).
- **Temel Prensip:** İnternet kopsa dahi kesintisiz satış, yerel SQLite üzerinde tam veri bütünlüğü, sıfır veri kaybı, milisaniyelik tepki süresi.
- **Dizin Yapısı:**
  - `backend/`: Rust + Tauri 2 + SQLite (sqlx) + Argon2id. Yüksek güvenlikli çekirdek motor.
  - `desktop/`: React 18 + Vite + TypeScript + Tailwind CSS v4 + Zustand + Lucide Icons. Yeni ortak tasarım sistemi (bölüm 4).
  - `web/`: Next.js + TypeScript + Tailwind CSS v4 + GSAP tanıtım sitesi ve müşteri portalı. Üyelik, paket seçimi, satın alma, abonelik ve cihaz yönetimi akışlarını içerir; ortak tasarım ilkeleri bölüm 4’tedir. Dosya adlarında çerçevenin zorunlu kıldığı `page.tsx`, `layout.tsx` gibi adlar istisnadır.
  - `backend/api/`: Hono + TypeScript API servisi. Üyelik, mail, lisans ve bulut eşitleme buradadır (MongoDB Atlas: hesap kümesi ve işletme kümesi); ticari kayıt otoritesi 360 Labs ile sürümlü sözleşmeler üzerinden haberleşir.
  - `../360labs/`: Platform yönetim konsolu; ürün, paket, abonelik, ödeme, cihaz hakları ve destek yönetimi.
  - `docs/`: Güncel uygulama planı, inceleme kanıtları ve teknik belgeler. Giriş noktası [ana plan](docs/uygulama-tamamlama-plani.md).

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
- Tüm IPC çağrıları Tauri `generate_handler!` sözleşmesine ve backend arayüzüne birebir uymak zorundadır.

---

## 4. FRONTEND TASARIM VE DENEYİM İLKELERİ

- Defter, adisyon kâğıdı, el yazısı, kareli yüzey ve kalemle çizilmiş düğme teması kullanılmaz. Bu karar finansal audit/cari kayıt modelini değiştirmez.
- Web, desktop ve Labs frontend’leri yeni tasarımla yeniden kurulacaktır. Test edilmiş backend iş kuralları ve IPC sözleşmeleri korunur; eksikler kanıtlı testlerle tamamlanır.
- Görsel ve davranış şartnamesi [tasarım planıdır](docs/tasarim-ve-deneyim-plani.md). Renkler semantik token'lardan gelir; eski `.paper/.sheet` sınıfları hedef tasarım değildir. Önerilen palet somut örnek ekranlarla değerlendirilir.
- Web ürün anlatımı ve dönüşüme, desktop hızlı operasyona, Labs yoğun kayıt ve sorun çözümüne göre düzenlenir. Aynı kart şablonu bütün ekranlara uygulanmaz.
- Login, lock, kurulum, alt sekmeler, modal, drawer ve toastlar dahil tüm ekranlar kapsamdadır. Loading/empty/error/offline/unauthorized durumları ayrı tasarlanır; kritik hata geçici toast ile kaybolmaz.
- Dokunmatik hedefler en az 48px; tutar ve saatler `tabular-nums`. Görünür etiket, klavye/odak yönetimi, yeterli kontrast, açık/koyu tema ve azaltılmış hareket desteği zorunludur.
- Ortak NumberInput, PIN, onay ve dialog davranışları merkezi bileşenlerden gelir. Uzun formda işlem altlığı görünür; hata sonrası girilmiş veri korunur.
- Kilit ekranında doğrulanan personelin oturumu açılır; önceki kullanıcının yetkisi taşınmaz. Ek cihaz mevcut işletmede ikinci OWNER oluşturmaz.
- Mobil aynı marka ve iş kurallarını kullanır; desktop ekranlarını daraltarak kopyalamak yeterli değildir. Platform fizibilitesi ve gerçek cihaz kabulü gerekir.

---

## 5. ROLLER VE YETKİ MATRİSİ (RBAC)

Sistemde tanımlı 6 temel rol bulunmaktadır. Fabrika kullanıcısı veya varsayılan PIN yoktur: temiz cihazda ilk OWNER hesabı kurulum sihirbazında oluşur, PIN'i kullanıcı belirler ve Argon2id ile saklanır. Diğer personeli OWNER tanımlar. Yükseltilen eski kurulumlarda fabrika PIN'i duran hesaplar ilk girişte PIN değiştirmek zorundadır.

| Rol | Yetki Kapsamı |
|---|---|
| **MASTER** | Platform yönetimi, kiracı oluşturma, lisanslama, global feature flag'ler. İşletme içi sayfalara ve tenant verisine giremez. |
| **OWNER** | İşletme sahibi. Tüm tenant sayfaları ve yetkileri; ödeme, personel maaş tutarı ve kritik operasyonlar. |
| **MANAGER** | Tüm işletme sayfalarına erişir. Kritik finansal/yıkıcı işlemler OWNER onayı ister; maaş tutarı görünürlüğü ayrıca `require_payroll_amounts` kapısıyla korunur. |
| **CASHIER** | Kasa, tahsilat, parçalı ödeme, POS, salon ve KDS. |
| **WAITER** | Masa düzeni, sipariş alma, mutfağa iletme, adisyon yazdırma. Tahsilat veya iptal yapamaz. |
| **KITCHEN** | Mutfak Ekranı (KDS). Bekleyen siparişleri görme, hazırlama ve teslim durumuna geçirme. |

---

## 6. ÖZELLİK BAYRAKLARI (FEATURE FLAGS)

Sistemde tanımlı 11 özellik bayrağı bulunur. Aşağıdaki açık/kapalı değerler mevcut referans durumudur; üretim erişimi sunucunun paket/lisans hakları ve rol ile birlikte belirlenir. Bir bayrağın listede açık olması özelliğin test edilmiş veya satışa hazır olduğu anlamına gelmez. Bayrak kapalıysa ilgili arayüz rotası açılmaz, doğrudan 404/Erişim Engellendi durumuna düşer (fail-closed):

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
   cargo test --lib                          # Testlerin tamamı başarılı (100% pass)
   cargo fmt --check                         # Standart Rust formatı
   ```

2. **Frontend Doğrulaması:**
   ```powershell
   npm run build                             # TypeScript derlemesi sıfır hata
   ```

3. **Kod Hijyeni Taramaları:**
   - Kod tabanında hiçbir yerde harici marka adı, aşama numarası veya geçici geliştirme etiketi yer alamaz.
   - UI kodunda kontrolsüz emoji veya ham Tailwind gradient kullanımı olamaz.


## 9. GÜNCEL PLAN VE BELGE DÜZENİ

- Tek uygulama giriş noktası [ana plan](docs/uygulama-tamamlama-plani.md); görev kapsamı ve bağımlılıkları oradan bağlı iş paketlerindedir. Aynı işi anlatan yeni paralel plan oluşturma; ilgili belgeyi güncelle.
- [İnceleme raporu](docs/uygulama-akis-incelemesi.md) gözlem ve kaynak bulgularıdır. [Kabul ve iş devri](docs/kabul-ve-is-devri.md) test/teslim ölçütlerini belirler. Planlanmış iş, uygulanmış ya da test edilmiş sayılmaz.
- Teknik güvenlik/eşitleme belgeleri mevcut uygulamanın dayanağıdır; içlerindeki eski tamamlanma iddiaları yeni testin yerine geçmez. Ana plandaki öneriler onaylanmış veya uygulanmış davranış gibi sunulmaz.
- Özellikle internet kesintisi ile LAN bölünmesi farklıdır. Mevcut ada mekanizmasının çift tahsilatı önlediği varsayılmaz; C07’deki önerilen otorite politikası uygulanmadan önce mevcut veriler ve geçiş testleri değerlendirilir.
- Feature kapalıysa modül rotası, kısayolu ve mutasyon komutu reddedilir. Geçmiş veriye erişim ayrı rol korumalı rapor/export yüzeyinden sağlanır; kapalı modülü açmak için kullanılamaz.
- Kullanıcının mevcut değişiklikleri korunur. Görev dışı reset, toplu silme veya yeniden yazım yapılmaz. Her görev kanıtıyla teslim edilir; gerçek ödeme, gönderim ve production işlemleri ilgili yetkilendirme olmadan yapılmaz.
- Yalnız dokümantasyon değişikliğinde uygulama derlemesi yerine bağlantı, tutarlılık, UTF-8 ve dosya sınırı kontrolü yapılır. Ürün kodu değişikliklerinde bölüm 8 geçerlidir.


## Güncel çalışma biçimi — 7 Kasım 2026

Kullanıcı 7 Kasım 2026’da işi Claude’a tam devretti: Claude web, API, Labs, desktop ve başlatıcı dahil kalan listeyi yürütür; kanıtı yalnız execution-status.md’ye ekler. Mevcut değişiklikler korunur. Ortak kabul yapılmadan bütünleşik tamamlanma iddiasında bulunulmaz.

İşler çalışan kullanıcı akışları halinde tamamlanır. Gerekli API, frontend ve test değişiklikleri aynı teslimde ele alınabilir; görev numarası veya eksik ilgisiz envanter tek başına ilerleme engeli değildir. Bir sabit, tip veya belge değişikliğinden sonra tur sonlandırılmaz; anlamlı akış tamamlanana veya kullanıcı girdisi gerektiren gerçek engel çıkana kadar devam edilir. Kısa ilerleme bilgisi vermek çalışmayı durdurma nedeni değildir.

Hız için gereksiz refactor, yeniden planlama, yeni rapor ve tekrarlı test koşuları yapılmaz. Finans, tenant/rol güvenliği, veri bütünlüğü ve zorunlu derleme/test kontrolleri korunur. İlgili kontrat kodla birlikte güncellenir; mock gerçek servis gibi sunulmaz. Testi geçen bir kapsam, daha geniş görevin tamamlandığı şeklinde işaretlenmez.
