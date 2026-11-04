# KASAM360 Web Sitesi Kararları

Bu belge ilk web sürümünün kapsamını ve sonraki satış altyapısının sınırlarını tanımlar. Sitedeki hiçbir vaat, kodda ve saha testinde karşılığı olmayan bir özelliği anlatamaz.

## Amaç

- İlk hedef, ödeme sağlayıcısının mağaza incelemesinde neyin satıldığını açıkça gösteren canlı bir site ve erken erişim talebi toplamaktır.
- Hedef kitle masa servisli restoran ve kafelerdir.
- Ana mesaj: internet kopsa da servis durmaz; stok maliyeti ve kasa farkı gerçek sayılarla görünür.
- Sitede ödeme, hesap oluşturma ve uygulama indirme ilk sürümde yer almaz.

## Yayın sırası

1. Tanıtım sitesi, abonelik sayfası, erken erişim formu ve yasal sayfalar yayına çıkar.
2. Ödeme sağlayıcısı mağaza başvurusu yapılır.
3. Sunucu, yönetim uygulaması ve lisans etkinleştirme tamamlanır.
4. Saha testi geçer, mali müşavir görüşü alınır, ödeme ayardan açılır.

Saha testi geçmeden gerçek ödeme alınmaz.

## İlk sürüm kapsamı

| Sayfa | İçerik |
|---|---|
| Ana sayfa | Defter yaprakları: ürün mesajı, internet kesme denemesi, örnek adisyon akışı, para güvenceleri, mali belge ve ürün durumu; gerçek ekran görüntüleri ayrıca eklenir |
| Özellikler | Masa, sipariş, mutfak ekranı, bölünmüş ödeme, stok ve FIFO, cari, personel ve bahşiş, QR menü, fiş yazdırma, yerel ağda çoklu cihaz |
| Abonelik | İşletme başına aylık veya yıllık abonelik modeli ve kapsamı; tutar için `Yakında` |
| Erken erişim | Form; talepler e-posta olarak iletilir |
| Yasal | Kullanım şartları, gizlilik, KVKK aydınlatma metni, iade koşulları, iletişim |

Paket adları ve tutarlar ilk sürümde gösterilmez.

## Vaat sınırları

- Ürün `işletme yönetimi ve adisyon yazılımı` olarak anlatılır, mali belgenin mevcut ÖKC'den kesildiği açıkça yazılır.
- Sitede `e-Adisyon uyumlu`, `yazar kasa yerine geçer`, `GİB entegrasyonu` ifadeleri kullanılmaz.
- Kapalı özellikler anlatılmaz: paket servis entegrasyonu, arayan numara, çoklu şube, dinamik fiyat, sandalye bazlı bölme.
- Müşteri sayısı, yorum, başarı oranı veya sertifika gibi kanıtsız ifadeler kullanılmaz.
- Görsel ve ekran verileri gerçek uygulamadan alınır; müşteri verisi içermez.
- Yalnız yazılım aboneliği satılır. Donanım, kurulum, eğitim ve danışmanlık bu ödeme kanalında satılmaz.

## Teknik kararlar

- `web`: Next.js, React, TypeScript, Tailwind CSS v4, GSAP. Tarayıcı `/api` isteklerini `API_ORIGIN` adresine iletir.
- `backend/api`: Hono, TypeScript. Üyelik ve mail burada çalışır; sunucu tarafı işler burada toplanır.
- Ana adres `kasam360.com.tr`. Site barındırması Vercel; API barındırması ayrıca seçilir.
- Görsel dil adisyon defteridir: spiral, kopya nüsha renkleri, basılı form, tükenmez kalem. Logo kullanımı marka kılavuzunu izler, turuncu yalnız logonun sıfır çentiğindedir.
- Tek orkestre hareket kalemle dolan form ve yaprak koparmadır; bölüm girişlerine ayrı animasyon eklenmez. Dar, alçak veya dokunmatik ekranda ve hareket azaltma açıkken yapraklar normal akışta alt alta durur.
- Her yaprak aynı üst satırı ve kolon çizgisini kullanır. Kopya nüshalar aynı seri numarasını taşır ve tek renk logo basar; renkli logo yalnız asıl yapraktadır.
- Form backend'de doğrulanır, spam koruması taşır ve KVKK onayı olmadan gönderilmez.
- İçerik sürümlenen dosyalarda durur. Sunucu bağlanınca paket ve fiyat buradan okunur.

## Sonraki satış altyapısı

- Müşteri, paket, fiyat, lisans ve askıya alma kayıtlarının tek gerçek kaynağı bulut sunucusudur. Site, POS uygulaması ve yönetim uygulaması aynı API'ye bağlanır.
- Abonelik ve lisans durumu sağlayıcıda değil sunucumuzda tutulur. Sağlayıcı yalnız ödeme bildirimi kaynağıdır; sağlayıcı değişirse masaüstü sürümü etkilenmez.
- Yönetim uygulaması ayrı bir Windows uygulamasıdır ve `admin/` klasöründe yer alır. Yalnız istemcidir: veritabanı şifresi veya lisans imzalama anahtarı içermez. Girişte iki aşamalı doğrulama kullanılır, her işlem kaydedilir, kişi bazlı roller sonradan eklenir.
- POS'taki yerel `platform_commands` kiracı ve lisans işleri yönetim uygulamasına taşınır. POS yalnız imzalı lisansı doğrular.
- Fiyat ve paket yapısı yönetim uygulamasından değiştirilir, kod sürümü gerektirmez.

## Lisans davranışı

- İlk etkinleştirmede bir kez internet gerekir. Sunucu imzalı lisans belgesi verir, uygulama bunu internetsiz doğrular.
- Belge 30 gün geçerlidir ve internet buldukça yenilenir.
- Süre dolunca 14 gün uyarı verilir.
- Uyarı süresi bitince yalnız yeni satış durur. Açık adisyonu kapatma, rapor, yedek ve veri dışa aktarma açık kalır.
- Müşterinin verisi hiçbir durumda erişilemez hâle getirilmez.

## Ödeme öncesi açık kalemler

- Ödeme sağlayıcısının şahıs satıcıyı onaylaması; dokümanlarda açıkça yazmıyor, başvuru sonucu ile netleşir.
- Satış belgesinin Türkiye'deki işletmelerin giderleşmesindeki durumu ve şahıs hesabına gelen gelirin vergisi; mali müşavir görüşü gerekir.
- Tutarın dolar karşılığı tahsil edilmesi; kur farkı ve kart masrafı müşteriye önceden anlatılmalıdır.
- Sağlayıcının platform geçişi olursa Türkiye'den satışın devamı; başvurudan önce destekten teyit edilir.
- e-Adisyon entegrasyonu ayrı yol haritası işidir; zorunluluk kapsamı resmî kaynaktan doğrulanır.
- `fiscal_receipt_no` resmî mali belge numarası değildir; fişte bu şekilde algılanmaması için gözden geçirilir.
- Paket içerikleri, tutarlar ve deneme süresi kesinleştirilir.

## Yayın öncesi kullanıcıdan gerekenler

- `kasam360.com.tr` alan adı ve DNS erişimi.
- Sitede görünecek e-posta adresi ve talepleri alacak adres.
- Kullanım şartları ve gizlilik metinlerinde görünecek satıcı adı ve iletişim bilgisi.
- Yasal metinlerin hukuk veya mali müşavir kontrolü.
