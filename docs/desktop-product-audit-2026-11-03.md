# Masaüstü ürün denetimi — 3 Kasım 2026

## Karar

Ürün bu incelemeyle üretime onaylanamaz. Ana modüller açılıyor ve sipariş mutfağa ulaşabiliyor; ancak hesap yaşam döngüsü, stok görünürlüğü, kritik işlem açıklamaları ve işletmeyi kurtarma yolları henüz tutarlı bir ürün oluşturmuyor. Görsel kimlik mevcut; bilgi hiyerarşisi ve operasyonel geri bildirim bunun gerisinde.

Bu rapor yeniden yazım talebi değildir. Önce mevcut akışların aşağıdaki kabul şartlarını sağlaması gerekir.

## İncelemenin sınırı ve kanıtı

- Ana kaynak: `C:/Users/Eren Tokgöz/Desktop/Projects/kasam360`, `develop` ve commitlenmemiş güncel dosyalar. Önceki eski worktree incelemesinin sonuçları güncel sürüm raporu olarak kullanılamaz.
- Çalışan uygulama: `backend/target/debug/kasam360-core.exe`. Bu ikilinin güncel tüm Rust değişikliklerini içerdiği bu turda yeniden derlenerek doğrulanmadı. Kaynak bulguları ile ekranda gözlenenler aşağıda ayrıdır.
- Asıl SQLite dosyasından SQLite backup API ile ayrı geçici kopya oluşturuldu. Yeni OWNER hesabı yalnız bu kopyada açıldı; asıl sahip hesabı değiştirilmedi.
- Test ortamı: `C:/Users/Eren Tokgöz/AppData/Local/Temp/kasam360-review-2219a5dc0523493a889cb00d85437ada/review.db`.
- Kullanıcı giriş yaptıktan sonra gerçek Tauri penceresinde 2048×1104 ve yaklaşık 1200×830 dış pencere boyutlarında inceleme yapıldı. İkinci boyut uygulamanın 1200×800 yapılandırmasına yakın standart pencere durumudur.
- Açık ve koyu tema görüldü. Salon, kişi seçimi, masa siparişi, ödeme/cari ödeme, mutfak, kasa/fişler/gün sonu, yönetimin yedi sekmesi, cari formu, personel/bordro/bahşiş, ürün ayrıntısı/reçete, stokun dört sekmesi, ayarların üç bölümü, kroki, rezervasyon ve tezgah satışı açıldı.
- Test kopyasında Masa 1 için iki kişi seçildi; 100 TL'lik tek ürün eklendi ve mutfağa gönderildi. KDS'de aynı sipariş görüldü. Tahsilat, iade, gün kapama, stok düzeltmesi ve geri yükleme tamamlanmadı.
- Cari rehber boştu; dolu cari ekstre bu turda ekrandan doğrulanmadı. Fiş listesi de boştu; iade ayrıntı ekranı görülmedi.
- Gerçek iki cihaz, ağ kesintisi, elektrik kesintisi, yazıcı, Google girişinin tamamı ve bulut geri yükleme bu turda sınanmadı. Ekran gezmek bu testlerin yerini tutmaz.

## Doğrulama

- Güncel ana projede masaüstü build geçti; 120 frontend testi geçti.
- API TypeScript kontrolü ve 18 API testi geçti. Negatif senaryolarda beklenen kimlik doğrulama uyarıları çıktı; test sonucu başarılıydı.
- Önceki 1043 Rust testi eski worktree'de koşulmuştu; güncel ana projenin testi olarak gösterilemez.
- Güncel frontend'de tarayıcı mock yanıtı kaldırılmış. Gerçek SMTP göndericisi `backend/api/src/lib/mail.ts` içinde var. Önceki rapordaki “gerçek SMTP hiç yok” ve “mock katmanı hâlâ aktif” genellemeleri güncel çalışma için yanlıştır. Rust'taki harici rapor kuyruğu ayrıca incelenmelidir.

## Öncelikli akış bulguları

| No | Öncelik | Kanıt / sorun | İşletmeye etkisi | Kabul şartı |
|---|---|---|---|---|
| A01 | P1 | Giriş ekranında yerel hesap hatası ve Google hesabı uyuşmazlığı aynı anda kalıyordu; kurtarma yolu görünmüyordu. | Cihazın sahibi bile kasaya ulaşamayabiliyor; destek müdahalesi gerekiyor. | İşletme adı ve beklenen hesap ilişkisi anlaşılır olmalı; hesap kurtarma ve güvenli işletme değiştirme yolları uçtan uca çalışmalı. |
| A02 | P1 | `account_sign_in` yerel kullanıcı özetiyle doğruluyor; web şifre sıfırlama sunucu hesabını değiştiriyor. | Web'de yenilenen şifrenin masaüstünü açacağı beklentisi karşılanmayabilir. | Online giriş, offline giriş ve şifre yenileme sonrası yerel doğrulama politikası birlikte tanımlanmalı ve test edilmeli. |
| A03 | P1 | Ayarlarda cihazdan hesap çıkışı var; mevcut Rust yolu yalnız `device_session` kaydını kapatıyor. | Kullanıcının istediği cihazı işletmeden ayırma ve başka işletmeyle açma davranışı sağlanmıyor. | Bulutta doğrulanmış kopya, cihaz yetkisi iptali ve yerel verinin güvenli kaldırılması; yarıda kesilmeye dayanıklı bir akış halinde tamamlanmalı. Bu sağlanmadan silme eklenmemeli. |
| A04 | P1 | Yeni kurulumun `complete_business_setup` komutu web hesabına ait sunucu kanıtı yerine formdaki e-posta/şifreyi alıyor. | Web hesabına bağlı işletme kurulmuş olduğu yalnız arayüz akışına dayanıyor. | Backend, doğrulanmış hesap kimliği ile işletme sahipliğini bağlamalı; form e-postası değiştirilerek bağ aşılmamalı. |
| A05 | P1 | Cihaz eşleştirme ve temiz kurulumdan yedek açma bileşenleri kaldırılmış; mevcut kurulum ekranı yalnız hesap/yeni işletme yoluna gidiyor. | Hazır LAN altyapısına kullanıcının ulaşabileceği kurulum yolu eksik. | Temiz ikinci cihazda mevcut işletmeye katılma ve arızalı cihaz yerine geri yükleme, dosya/DB düzenlemeden tamamlanmalı. |
| A06 | P1 | Ayarlar yalnız İşletme, Salon ve Yedek içeriyor; cihaz üyeliği, eşleştirme ve devralma ekranı bulunamadı. `SyncStatusChip` açıklaması Ayarlar'a yönlendiriyor. | Bağlantı sorunu yaşayan işletmeci neyi yöneteceğini bulamıyor. | Cihaz listesi, bağlantı durumu, son eşitleme, pasife alma ve kayıp cihaz akışları erişilebilir olmalı. |
| A07 | P1 | Stok ekranı ürünü “Stok yok” gösterirken aynı ürün siparişe eklenip mutfağa gönderilebildi; hareketlerde -1 satırı oluştu. | Sayısal stok, satılabilirlik ve maliyet bilgisi birbirini açıklamıyor. | Negatif/izlenmeyen stok politikası görünür olmalı; bilinmeyen maliyet kâr raporunda sıfır maliyet olarak yorumlanmamalı. Satışı kesin engellemek ürün kararıdır. |
| A08 | P1 | Sayımda açık ama satırsız durumda “Sayımı Kapat ve Stoğa Uygula” görünür. Kaynak doğrudan `applyAdjustment: true` gönderiyor. | Sayım sonucu ve stok etkisi anlaşılmadan düzeltme başlatılabilir. | Kör sayım korunmalı; kapanışta sayılan satırlar, kapsam ve farkların inceleme/onay adımı olmalı. Boş veya eksik sayımın davranışı açıkça test edilmeli. |
| A09 | P1 | Kritik kayıt ekranı son 500 genel kaydı getirip kritik türleri istemcide süzüyor. | Yoğun sipariş trafiği eski ama önemli kayıtları görünmez bırakabilir; tarih filtresi de onları geri getirmez. | Kritik tür/tarih/aktör filtreleri sunucuda uygulanmalı; sayfalama ile tüm geçmiş erişilebilir olmalı. |
| A10 | P1 | Kritik kayıtlarda “Onay yetkisi değişikliği” ve aktör var, hedef personel ve önce/sonra değeri görünmüyor. | Patron kimin yetkisinin değiştiğini anlayamıyor. | Her kritik işlemde yapan, hedef, değişen değer, zaman, gerekçe ve varsa onaylayan gösterilmeli; ilgili kayda gidilebilmeli. |

P1: ilgili akış üretimde destek veya veri güveni sorunu çıkarır; hedefli düzeltme ve doğrulama gerekir. Bu liste tek başına istismar kanıtı veya bütün güvenlik denetimi değildir.

## Ekran bazında ürün ve UX eleştirisi

| No | Ekran | Gözlem | Düzeltmenin kabul şartı |
|---|---|---|---|
| U01 | Genel kabuk | Her modülün ayrı pastel rengi var; seçili sayfa, işlem seçimi ve uyarı anlamları aynı renk dili içinde rekabet ediyor. | Seçili gezinme, birincil işlem ve durum renkleri birbirinden ayırt edilmeli; renk tek belirteç olmamalı. |
| U02 | Koyu tema | Arka plan koyulaşıyor ama ana sarı kâğıt yüzeyler açık kalıyor. | Düşük ışıkta esas çalışma yüzeylerinin parlaklığı da azaltılmalı veya bu seçimin adı beklentiye uygun değişmeli. Mevcut anayasa bunu bilinçli seçmiş; uygulama hatası değil ürün önerisidir. |
| U03 | Tipografi | Başlıklar belirgin; yardımcı metinler ince ve küçük. Çizgiler ve dekorasyon yoğun tabloları daha zor taratıyor. | Tutar, kişi, durum ve hata metni hızla ayırt edilmeli; dekorasyon veri satırını bölmemeli. Küçük POS ekranında ayrıca doğrulanmalı. |
| U04 | Salon kartları | Kart alanının çoğu boş, bilgi küçük masa çizimine sıkışıyor. Dolu/boş masa ayrımı özellikle sandalye rengine dayanıyor. | Masa adı, tutar, geçen süre ve durum çizimin dışında da okunmalı; dolu ve hesap isteyen masa uzaktan seçilebilmeli. |
| U05 | Kişi seçimi | Yalnız 1,2,3,4,5,6,8,10 seçenekleri var. 7,9 veya 10'dan fazla kişi için giriş yok. Kaynak: `GuestPickerModal.tsx`. | Hızlı seçeneklerin yanında her geçerli kişi sayısı girilebilmeli; kapasiteyle ilişkisi açıklanmalı. |
| U06 | Kroki | Tüm alanı sığdırırken masalar küçülüyor. Standart pencerede isim/tutar okunmuyor; dolu masa metni çizimden taşıyor. Koyu temada bölüm başlıklarının kontrastı zayıf. | Minimum dokunma alanı ve yazı boyutu korunmalı; bölüm seçimi ve yakınlaştırma bunun üzerinde çalışmalı. |
| U07 | Sipariş | Mutfağa gönderimden sonra kalem, gönderilmeden öncekiyle neredeyse aynı. Yalnız gönder düğmesi pasifleşiyor. | Yeni / gönderildi / hazırlanıyor / hazır ayrımı kalem üzerinde görünmeli; işlem başarısı açıkça anlaşılmalı. |
| U08 | Sipariş | Sepette miktar ve satır eylemleri ilk bakışta keşfedilmiyor. Tek ürünlü katalogda ürün kartı çok geniş kalıyor. | Kalem düzenleme, not ve adet eylemleri görünür olmalı; kart düzeni ürün sayısı ve ekran boyutuna uygun yoğunlukta olmalı. |
| U09 | Cari ödeme | Müşteri seçilmemişken “100,00 TL Tahsil Et” etkin görünüyor. Veresiye işlemi de tahsilat diye adlandırılıyor. | Müşteri zorunluluğu düğmeden önce anlaşılmalı; buton “Cariye Yaz” gibi yapılan işlemi anlatmalı. Backend'in reddedip reddetmediği bu turda denenmedi. |
| U10 | Ödeme | Kanal değişince pencerenin yüksekliği ve alanların konumu değişiyor. | Kanal seçimi ve son işlem düğmesi mümkün olduğunca sabit kalmalı; dokunmatik kasada yanlış hedef riski azaltılmalı. |
| U11 | Mutfak | Tek sipariş başarıyla göründü; bu olumlu. Kartta “Bekliyor” küçük bir etiket, bekleme süresi de küçük. | Yoğun servis ve gecikmiş siparişler ile kalem/masa farkı büyük ve açık biçimde görülmeli. Çok biletli yük senaryosu ayrıca gerekli. |
| U12 | Kasa | Vardiya hareketleri ile aylık giderler aynı sayfada. “Gider Öde” ve “Gider Ekle” farklı yerlerde duruyor. | Aktif kasanın dönemi/sorumlusu ile aylık finans görünümü açık ayrılmalı; gider oluşturma ve ödeme farkı anlaşılmalı. |
| U13 | Kasa | Test kopyasında çekmece -110 TL; rakam normal koyu metinle gösteriliyor, açıklayıcı uyarı yok. | Negatif kasa görünür uyarı ve hareket açıklaması taşımalı; bunun otomatik olarak veri hatası olduğu iddia edilmemeli. |
| U14 | Gün sonu | Açık vardiya ve açık adisyon varken tam genişlikte kırmızı “Günü Kapat” sunuluyor. Engeller önceden listelenmiyor. | Kullanıcı düğmeye basmadan açık vardiya/adisyonları görmeli ve çözüm ekranına gidebilmeli. Backend kapanışının aşıldığı kanıtlanmadı. |
| U15 | Genel bakış | Menü Analizi paneli “okunamadı” diyor; yeniden deneme ve sebep yok. `panoramaStore` alt hatayı `catch(() => null)` ile kaybediyor. | Hata, veri yok ve yükleniyor ayrı görünmeli; yalnız bozuk panel yeniden denenebilmeli. |
| U16 | Cari | Boş durumda iki ayrı panel “kart yok” diyor; yüksek boş defter alanı kaplıyor. | Tek açıklayıcı boş durum ve doğrudan kart ekleme eylemi olmalı. |
| U17 | Cari form | Cari limitinin boş, sıfır veya sınırsız anlamı açıklanmıyor. | Limitin anlamı giriş yanında net olmalı; tutar/birim ve limit aşımı davranışı anlaşılmalı. |
| U18 | Personel | Kişiler → kişi → yedi alt sekme, ayrıca Bordro/Bahşiş üst sekmeleri var. Bilgi kapsamı geniş, genel özet zayıf. | Kişi kartında çalışma durumu, işe giriş, maaş dönemi, avans/bahşiş özeti ve bekleyen işler görülebilmeli; ayrıntı isteğe bağlı açılmalı. |
| U19 | Bordro | Hesaplama düğmesi pasif, sebep görünmüyor. Kaynakta `rules.length === 0` koşulu var. | “Maaş kuralı tanımlayın” açıklaması ve ilgili kişi/kural ekranına bağlantı olmalı. Pasif düğme son durak olmamalı. |
| U20 | Bahşiş | Boş havuz açılır açılmaz “Toplam %0, %100 olmalı” kırmızı uyarısı var. Tarih 2026-11 biçiminde; dönem seçimi görünmüyor. | Henüz işlem yapılmadan hata gösterilmemeli; seçilen dönem ve dağıtım politikası anlaşılmalı. |
| U21 | Bütçe | Kâr tablosunda dönemi seçen/gösteren başlık yok. Sabit giderde “1” kutusunun ne olduğu görünür etiketle anlatılmıyor. | Kârın tarih aralığı ile giderin ödeme günü/birimi açıkça yazmalı; placeholder etiket yerine geçmemeli. |
| U22 | Tarife | Saat/tarih ve günler mevcut; boş gün seçimi, boş tarihler ve gece yarısını geçen zaman aralığı açıklanmıyor. Fiyat önizlemesi yok. | Kaydetmeden önce hangi ürünün ne zaman hangi fiyata çıkacağı görülebilmeli; çakışan tarifelerin önceliği belirtilmeli. |
| U23 | Raporlar | Mali müşavir raporu her şeyden önce geliyor; iki tarih alanı da yalnız “Tarih”. Kullanıcı raporu üç ayrı seçim sırasıyla kuruyor. | Rapor türü, başlangıç-bitiş ve seçili dönem açık olmalı; günlük ihtiyaçlar öne gelmeli. İmzalı dosyanın ne olduğu açıklanmalı. |
| U24 | Ürün ayrıntısı | Ürün bilgisi ve Menü Ayarları için iki ayrı kaydetme var; seçenek/reçete başka alanlarda. Kaydetmeden ayrılma sonucu belirsiz. | Değişen bölümler işaretlenmeli; kaydedilmemiş değişiklikle ayrılma ele alınmalı; kayıt kapsamı anlaşılmalı. |
| U25 | Reçete | “Hammaddeyi fiyatsız ürün olarak oluşturun” deniyor, doğrudan oluşturma yolu yok. Malzeme menü ürünüyle kavramsal olarak karışıyor. | Reçeteden hammadde eklenebilmeli; hammadde, stok ürünü ve satılan ürün ayrımı kullanıcıya açık olmalı. |
| U26 | Stok | Ana menüde “Menü” altında saklı. Miktar girişlerinde ürünün birimi her yerde görünmüyor. | Stok ilk kez kullanan biri tarafından bulunabilmeli; miktarın kg/adet/litre anlamı seçili ürünle birlikte görünmeli. |
| U27 | Satın alma | Tedarikçi oluşturma cari rehberden ayrı bir panelde, ilk siparişte boş kalem listesi var. FIFO teknik adı kullanıcıya sunuluyor. | Cari tedarikçi bağlantısı belirgin olmalı; ilk kalem ekleme ve mal kabul → belge → borç adımları görünür olmalı. |
| U28 | Stok hareketleri | Adisyon kaynağı metin; ekrandan kaynağa gitme veya tarih aralığı seçme yolu görünmedi. | Hareketten ilgili belge/adisyona gidilmeli; ürün/tarih/neden filtreleri ve öncesi-sonrası miktarı değerlendirilmeli. |
| U29 | Yedek | Ham dosya yolları uzun satırlar halinde. Kopyada eski son-yedek zamanı görünüyor fakat yerel listede dosya yok. | “Son yedek” gerçekten erişilebilir/doğrulanmış dosyayla ilişkilendirilmeli; boş liste ve başka cihazdan gelen metadata açıklanmalı. Kopyalama koşulunun etkisi ayrıca test edilmeli. |
| U30 | Rezervasyon | Yeni kayıt formu var; bekleyen liste boşken büyük panel kaplıyor. Tarih ve masa uygunluğunun takvim görünümü yok. | Seçili gün/saat ve masa uygunluğu aynı akışta görülmeli; çakışmanın kontrol edildiği anlaşılmalı. Backend çakışma kuralı bu turda sınanmadı. |

## Rakip ürün yöneticisi gözüyle satış kaybettiren noktalar

1. “Kendi hesabımla kasaya neden giremiyorum?” sorusuna ekrandan çözüm bulunamıyor.
2. “İkinci cihazı nasıl bağlarım?” sorusunun cevabı güncel ekranda bulunmuyor.
3. “Stok yokken nasıl sipariş verdim, bunun maliyeti ne oldu?” sorusu kullanıcıya açıklanmıyor.
4. “Kim, kime hangi yetkiyi verdi?” sorusu kritik kayıttan cevaplanamıyor.
5. “Koyu temada neden çalışma alanı hâlâ parlak?” beklentisi karşılanmıyor.
6. “Bordro düğmesi neden çalışmıyor?” sorusuna kullanıcı kendisi yol bulmak zorunda kalıyor.
7. “Gün sonundan önce neyi kapatmalıyım?” bilgisi işlemin önünde görünmüyor.

Ürünün eksikliği yalnız tasarım cilası değildir: işlem öncesi yönlendirme, işlem sonrası kanıt ve hata sonrası kurtarma halkaları eksik.

## İş paketlerinin sırası

1. **Hesap ve cihaz yaşam döngüsü:** A01–A06. Web kimliği/yerel erişim/bulut kopyası/ayırma/ikinci cihaz/geri yükleme tek kabul senaryosuna bağlanır.
2. **Stok ve kasa güveni:** A07–A08, U09, U12–U14, U21, U26–U29. Satış, maliyet, sayım ve gün sonu verisinin açıklanabilirliği tamamlanır.
3. **Yönetici denetimi:** A09–A10, U15, U18–U20, U22–U23. Yetki, dönem, hata ve rapor bilgisi görünür hale gelir.
4. **Operasyon ergonomisi:** U01–U08, U10–U11, U16–U17, U24–U25, U30. Mevcut görsel dil içinde ekran boyutu, bilgi yoğunluğu ve dokunma hedefleri düzeltilir.
5. **Üretim doğrulaması:** Dolu cari/ekstre/iade, tüm roller, çok ürünlü servis, iki gerçek cihaz ve üç cihazda devralma, elektrik kesintisi, yazıcı, gerçek geri yükleme. Her bulgunun kabul şartı test sonucuna bağlanır.

Mobil ve platform yönetim uygulamasına bu hatalar aynen taşınmamalı. Masaüstündeki akışlar kararlı hale geldikten sonra mobilde role ve ekran boyutuna göre yeniden düzenlenmelidir.

## Sonraki teknik denetimde kapanacak belirsizlikler

- Güncel ana projede Rust testleri ve clippy; kaynak/çalışan ikili sürüm eşleşmesi.
- Feature flag'lerin yalnız düğme görünürlüğünde değil modül ve backend yetkisinde de uygulanması.
- Hesap sıfırlama/Google bağlantısı için tek kullanımlık kodun istek sahibine ve cihazına bağlanması.
- Yerel veritabanı, yedek ve cihaz gizli anahtarının erişim/şifreleme politikası.
- Snapshot'ın aynı transaction'dan tutarlı alınması, şema uyumu, yetkili yükleyici ve eski veriyi ezme koruması.
- LAN'da eşzamanlı iki tahsilat, cevap kaybı, yeniden deneme ve otorite değişimi.
- Stok maliyeti bilinmiyorken tüm kâr ekranlarının aynı sonucu ve uyarıyı vermesi.
- Gerçek ödeme entegrasyonu ile test POS'un prod davranışının ayrılması.

Bu maddeler doğrulanmadan “güvenlik açığı kapandı”, “sıfır veri kaybı” veya “üretime hazır” sonucu verilemez.
