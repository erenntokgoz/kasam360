# KASAM360 ürününü tamamlama ve satışa hazırlama planı

Tarih: 6 Kasım 2026. Durum: **uygulanacak plan; tamamlanmış ürün veya test raporu değildir.**

> Uygulayıcı ajan: `executing-plans` becerisiyle görevleri sırayla yürüt. Güncel Codex/Claude dosya sahipliği aşağıdaki çalışma biçimindedir. Bir görev tamamlanmadan bağımlı görevi tamamlandı işaretleme. Bu belge ve bağlı paketler birlikte tek plandır.

**Amaç:** Ziyaretçinin ürünü anlayıp hesap açtığı, doğru paketi satın aldığı, işletmesini kurduğu, masaüstünde güvenle çalıştığı; ekibin bütün hizmeti 360 Labs üzerinden yönettiği ve sonrasında mobilde sürdürebildiği bir ürün çıkarmak.

**Mimari:** Üç frontend yeniden tasarlanıp kontrollü olarak yeniden yazılır. Yerel Rust/SQLite işlem motoru korunur, eksikleri ve güvenlik sınırları testlerle tamamlanır. Hesap API'si müşteri kimliğini ve bulut erişimini, Labs ticari ürün ve abonelik kayıtlarını, cihazlar yerel işletme işlemlerini yönetir; ayrıntılı sahiplik sözleşmesi bağlayıcıdır.

**Teknoloji:** Mevcut Rust/Tauri/SQLite, React/Vite/TypeScript, Next.js, Hono/MongoDB ve Labs Rust/Axum altyapıları temel alınır. Yeni framework, veritabanı veya mikroservis kurmak varsayılan çözüm değildir.

**Dayanak:** [Ekran ve kaynak incelemesi](uygulama-akis-incelemesi.md). B01–B23 gözlem/kaynak bulgularıdır; yeni görevlerdeki riskler ayrıca test edilmedikçe yaşanmış hata diye sunulmaz. B23 ek kaynak incelemesidir, fiziksel ağ bölünmesi testi değildir.

## Güncel çalışma biçimi — 7 Kasım 2026

Kullanıcı Claude’u sınırlı kalan haftalık kotasıyla yeniden dahil etti. Bu teslimde Claude yalnız herkese açık web sayfaları, ortak görsel kabuk ve SEO/erişilebilirlik düzeltmelerini yürütür; yeni tema başlatmaz. Codex cihaz aktivasyonu, V2 lisans ve tenant kapsamlı sync akışını backend/API, Labs ve desktop üzerinde tamamlar; bu teslim sırasında web dosyalarını değiştirmez. Claude hesap/auth/destek iş mantığına, backend/API, Labs, desktop, bağımlılık ve kilit dosyalarına dokunmaz. Ortak CSS değişikliklerinde hesap/auth/destek ekranlarının görsel kontrolü yapılır. Mevcut değişiklikler korunur. İlerleme tablosunun tek yazarı Codex; Claude teslim kanıtını kullanıcıya sunar. İki teslim sonrası ortak kabul yapılmadan bütünleşik tamamlanma iddiasında bulunulmaz.

İşler çalışan kullanıcı akışları halinde tamamlanır. Gerekli API, frontend ve test değişiklikleri aynı teslimde ele alınabilir; görev numarası veya eksik ilgisiz envanter tek başına ilerleme engeli değildir. Bir sabit, tip veya belge değişikliğinden sonra tur sonlandırılmaz; anlamlı akış tamamlanana veya kullanıcı girdisi gerektiren gerçek engel çıkana kadar devam edilir. Kısa ilerleme bilgisi vermek çalışmayı durdurma nedeni değildir.

Hız için gereksiz refactor, yeniden planlama, yeni rapor ve tekrarlı test koşuları yapılmaz. Finans, tenant/rol güvenliği, veri bütünlüğü ve zorunlu derleme/test kontrolleri korunur. İlgili kontrat kodla birlikte güncellenir; mock gerçek servis gibi sunulmaz. Testi geçen bir kapsam, daha geniş görevin tamamlandığı şeklinde işaretlenmez.

Öncelik: Labs paket kataloğu → webde paket gösterimi → satın alma/abonelik → tenant kapsamlı lisans ve cihaz/sync → desktop operasyon ve tasarım kabulü → kurulum/pilot/yayın → mobil. İlgili güvenlik ve sözleşme işleri bu akışlarla birlikte tamamlanır. Kullanıcının kabul etmediği tasarım bütün ekranlara yayılmaz.

## Önce uygulanacak ürün kararları

1. **Defter, adisyon kâğıdı, el yazısı, kareli yüzey, kalemle çizilmiş düğme teması iptal.** Kullanıcının açık kararıdır. AGENTS.md içindeki eski görsel zorunlulukların yerine bu karar geçer. Finansal `audit_ledger` ve cari hesap kavramları korunur; görsel tema ile veri modeli karıştırılmaz.
2. Desktop, web ve Labs için yeni frontend hedeflenir. Eski ekranları yalnız renklendirip teslim etmek yeterli değildir. Test edilmiş iş kuralları, IPC sözleşmeleri ve erişilebilirlik davranışları yeniden yazım sırasında kaybedilmez.
3. Web bir vitrin ve müşteri portalıdır; günlük restoran kasası değildir. Labs platform ekibinin yönetim konsoludur; işletme sahibinin POS'u değildir. Desktop ve sonra mobil işletmenin operasyon aracıdır.
4. Yeni ekranın normal görünümü kadar yüklenme, boş, hata, yetkisiz, çevrimdışı, süresi dolmuş ve işlem sürüyor halleri teslim kapsamındadır.
5. “Kusursuz” beyanı yerine ölçülebilir çıkış kapıları kullanılır. Satış aciliyeti finans, veri bütünlüğü, yetki veya lisans testlerini kaldırmaz.
6. Mobil tam ürün kapsamındadır. Ancak desktop ve ortak sözleşmeler kararlı olmadan bütün ekranlar mobile taşınmaz. Erken teknik deneme yapılabilir; tam mobil uygulama daha sonra gelir.
7. Yeni MongoDB kümeleri şu an ön koşul değildir. Hesap/işletme ayrımı, yedek, indeks, erişim ve geri yükleme önce doğrulanır. Kapasite/izolasyon gereği ölçülürse yeni küme istenir.
8. **Önerilen teknik karar:** İlk ücretli sürümde bir işletmenin finansal işlemleri tek yerel işlem otoritesinden geçer. İnternet kesilince yerel çalışma sürer; LAN'dan kopan ikincil cihaz aynı siparişi bağımsız tahsil edemez. Mevcut ada yazması bu güvenceyi sağlamış sayılmaz. Otorite devri, eski ada kayıtlarının kurtarılması ve çevrimdışı sınırlar C07'de açıkça tanımlıdır. Bu yeni bir plan önerisidir; uygulanmış ya da daha önce kullanıcı tarafından onaylanmış mimari diye sunulmaz.

## Plan dosyaları ve okuma sırası

| Dosya | İçerik | Görevler |
|---|---|---|
| [Tasarım sistemi](tasarim-ve-deneyim-plani.md) | Özgün görsel yön, sayfa kompozisyonu, login/lock, modal, toast, hareket, erişilebilirlik | D01–D08 |
| [Sözleşmeler ve backend](sozlesmeler-ve-backend-plani.md) | Kimlik, tenant, paket, ödeme, lisans, eşitleme, bildirim, veri güvenliği | C01–C12 |
| [360 Labs](labs-tamamlama-plani.md) | Yönetim kabuğu, işletmeler, paket yayını, finans, destek, gelen kutusu, güvenlik | L01–L10 |
| [Web ve müşteri yolculuğu](web-tamamlama-plani.md) | Yeni site, SEO/GEO, üyelik, satın alma, hesap, cihazlar, destek | W01–W10 |
| [Desktop](desktop-tamamlama-plani.md) | Kurulumdan gün sonuna ekranlar ve operasyon testleri | P01–P13 |
| [Mobil ve yayın](mobil-ve-yayin-plani.md) | Mobil mimari denemesi, telefon/tablet akışları, mağazalar, yükleyici, üretim | M01–M06, R01–R06 |
| [Kabul ve iş devri](kabul-ve-is-devri.md) | Ortak test verisi, uçtan uca senaryolar, komutlar, görev teslim formatı | Q01–Q07 |

Dosya yolları ilgili depoya göre verilir: `kasam360` bu depo; `360labs` kardeş depo. “Yeni” olarak işaretlenen dosyalar planlanan çıktıdır, mevcut oldukları iddia edilmez. Her dosya en fazla 500 satır; aşınca sorumluluğa göre böl.

## Müşterinin uçtan uca yolculuğu

| Adım | Müşterinin sorusu / hissi | Sistem davranışı | Başarı kanıtı |
|---|---|---|---|
| 1. İlk ziyaret | “Benim işletmeme uygun mu?” | Gerçek ürün görüntüsü, açık fayda, restoran/kafe örnekleri, çevrimdışı sınırlarının dürüst anlatımı | Fiyat ve ürün gösterimine ulaşabilir; reklam cümlesiyle teknik gerçek çelişmez |
| 2. Paket inceleme | “Ne alıyorum, toplam ne ödeyeceğim?” | Yayındaki paket, dönem, vergi açıklaması, cihaz/özellik sınırları | Webdeki teklif Labs paket sürümüyle birebir aynı |
| 3. Üyelik/giriş | “Hesabım açıldı mı?” | Google veya e-posta; doğrulama; güvenli geri dönüş | Başlangıçtaki paket seçimi kaybolmaz; çift müşteri oluşmaz |
| 4. İşletme oluşturma | “Bu hesap hangi işletmeye ait?” | Tenant ve OWNER üyeliği, işletme adı, ülke/para birimi/saat dilimi | Aynı isteğin tekrarı ikinci işletme yaratmaz |
| 5. Satın alma | “Karttan çekildi mi?” | Sunucunun ürettiği teklif; sağlayıcı ödeme ekranı; doğrulanmış olay | Tarayıcı dönüşü tek başına aboneliği aktifleştirmez |
| 6. Ödeme bekleniyor | “Yeniden ödemeli miyim?” | Açık bekleme durumu, sipariş numarası, yenile ve destek | Geciken webhook çift tahsilat/ikinci satın alma yaratmaz |
| 7. Hesap başlangıcı | “Şimdi ne yapacağım?” | Paket aktif, indirme, kurulum adımları, kalan cihaz hakkı | Kullanıcı doğru işletmeye ait imzalı yükleyiciyi bulur |
| 8. Cihaz bağlantısı | “Hesabım ve kasam bağlı mı?” | Tarayıcı onayı veya kısa ömürlü eşleme, cihaz kaydı, imzalı lisans | Başka tenant'a bağlanamaz; sınır aşımı açıklanır |
| 9. Yerel kurulum | “Satışa hazır mıyım?” | OWNER PIN, işletme ayarları, masa/ürün/istasyon, yazıcı denemesi | Adım adım ilerleme saklanır; kapanıp açılınca devam eder |
| 10. Günlük kullanım | “İşlemim kaydedildi mi?” | Yerel transaction, kesin sonuç, tekrar koruması, açık bağlantı durumu | Ağ kesilse satış korunur; belirsiz tahsilatta yeniden çekim teşvik edilmez |
| 11. Personel değişimi | “Kim işlem yapıyor?” | Kilit ekranı ve kişiye ait PIN; rol yetkisi | Önceki kişinin yetkisi yeni kullanıcıya taşınmaz |
| 12. Gün sonu | “Para ve stok tutuyor mu?” | Nakit/kart ayrı mutabakat, eksik işlemler, yedek ve eşitleme durumu | Tutarlar kayıtlarla birebir eşleşir; hata sıfır gösterilmez |
| 13. Yenileme/değişim | “Paketim biterse ne olur?” | Dönem sonu değişiklik, cihaz limiti ön kontrolü, açık erişim politikası | Web, Labs ve desktop aynı tarihi/durumu gösterir |
| 14. Destek | “Sorunumu biliyor musunuz?” | Ticket, tenant/cihaz/sürüm bağlamı, gizli verisiz tanılama | Labs yanıtı müşteriye gelir; e-posta ve uygulama mesajı karışmaz |
| 15. Ayrılma/kurtarma | “Verimi alabilir miyim?” | Abonelik iptali, veri dışa aktarımı, hesap silme ve saklama ayrımı | Yanlışlıkla işletme verisi silinmez; geri yükleme gerçekten denenmiştir |

## 360 Labs operatörünün karşı yolculuğu

Operatör oturum açar → kritik işler kuyruğunu görür → işletmeyi arar → kimlik, abonelik, cihaz, eşitleme ve destek zaman çizelgesini tek kayıtta görür → yetkisine göre çözüm uygular → sonucu ve denetim kaydını doğrular. Paket hazırlama/yayınlama, ödeme eşleme, elle hak verme, cihaz iptali ve mesaj gönderme ayrı yetkilerdir. “Her şeye erişen tek yönetici” çalışma modeli üretim standardı olmayacaktır.

Labs bağlantı sorunu yaşadığında POS açık lisansının çevrimdışı süresi içinde çalışır. Labs'ın müşteri listesi alınamadığında boş liste gösterilmez. Operatörün tahmini karar vermemesi için veri kaynağı ve son güncellenme zamanı görünür olur.

## Bağımlılığa göre uygulama sırası

| Kapı | Yapılacak iş | Çıkış koşulu | Sonra açılan iş |
|---|---|---|---|
| G0 — başlangıç | Q01; mevcut değişiklikleri koru, sürümleri eşle, test verisi oluştur | Repo/sürüm/env kaydı, mevcut hataların ayrımı | Diğer tüm işler |
| G1 — ürün temeli | C01–C03/C08/C11; D01–D04; ticari kararların kaydı | Kimlik/tenant/paket sözleşmesi, güvenlik temeli ve örnek ekran seti | Labs ve web kabuğu, desktop bileşenleri |
| G2 — çalışan ticari zincir | C04–C07; D05; L01–L05; W02–W07; R01 ilk test yükleyicisi; P01/P02 | Sandbox satın alma → hak → cihaz → desktop erişimi | Gerçek müşteri kabul provası |
| G3 — güvenilir operasyon | C07–C12; P03–P13; L06–L10; W07–W09; Q02–Q05 | Finans, offline, yetki, destek, kurtarma testleri | Windows pilot |
| G4 — görsel ve satış kalitesi | D03–D08 tüm ekranlara; W01–W02/W10; L01/P01; R01–R04 | Görsel kabul, erişilebilirlik, kurulum, ölçüm, destek hazırlığı | Kontrollü ücretli Windows yayını |
| G5 — mobil | M01 erken yapılabilir; M02–M06 G3 sonrası | Gerçek telefon/tablet, mağaza politikası ve ortak veri kabulü | Mobil mağaza teslimi |
| G6 — geniş yayın | R05–R06; Q06–Q07 | Pilot sorunları kapalı, geri dönüş tatbikatı ve operasyon sahipleri hazır | Genel erişim ve izleme |

Q01 başlangıç kapısı, henüz geliştirilecek C01 kontratını, L08 rollerini veya gerçek sağlayıcı sandbox'larını beklemez. Tekrarlanabilir güvenli yerel fixture ve mevcut durum/test kaydı yeterlidir; ayrıntılı sınır [Q01 kapsam düzeltmesinde](kabul-ve-is-devri.md) tanımlıdır. Bu başlangıç kanıtıyla C01 ve statik D01/D02 çalışması ilerler; gerçek servis entegrasyonunun kabul şartları sonraki görevlerde korunur.

Kapılar ilgili sonuçların kabul anıdır; görevlerin ilk başlama tarihi değildir. Örneğin G4 görsel kalite kapısıdır, D03/L01/P01 ilk kez G4'te yazılmaz. Her görevin kendi bağımlılığı bağlayıcıdır; ortak bileşen ve güvenlik işleri tüketiciden önce yapılır. G4 çalışmaları G2/G3 ile sözleşme sabitlendikten sonra paralel ilerleyebilir. Bu sıra mobil kapsamı iptal etmez; mobil beklenirken doğrulanmış Windows ürününü satabilme seçeneği sağlar. Kullanıcı bütün platformları aynı gün açmak isterse genel yayın G5 sonrasına alınır.

## Hemen tamamlanacaklar ve satışa açılmayacak vaatler

**İlk ücretli yayın için zorunlu:** yayımlanmış paket/gerçek fiyat, üyelik ve tenant, ödeme/abonelik mutabakatı, lisans/cihaz, yeni üç frontend, güvenli POS/kasa/stock çekirdeği, kurulum/yedek/kurtarma, Labs destek ve olay takibi, yasal metinler, üretim izleme.

**Kapsamdan silinmeyen fakat doğrulanana kadar satış vaadi yapılmayacaklar:** paket servis sağlayıcıları, caller ID, çoklu şube, sandalye bölme, gelişmiş dinamik fiyatlandırma, mobil mağaza sürümleri. Bayrak kapalı ve fiyat kartında açıkça “dahil” dışında tutulur. Etkinleştirilecek her modül için aynı güvenlik/akış kabulü gerekir.

QR menü için “yalnız görüntüleme” ile “müşteriden sipariş alma” ayrı yeteneklerdir. Genel bir QR kutucuğu ile ikisi birden satılmaz. Mali belge/e-fatura/ÖKC/POS cihazı entegrasyonu gerçekten uygulanıp yetkili değerlendirmeden geçmedikçe adisyon çıktısı mali fiş olarak tanıtılmaz.

## İşe başlamadan kesinleştirilecek dış kararlar

Bu kararlar bugünkü raporu engellemez. İlgili uygulama görevi gerçek hizmete bağlanmadan önce kayıt altına alınır; ajan kendi kendine ticari/yasal karar vermez.

| Karar | Hazırlanacak somut çıktı | Geçici çalışma kuralı | Bloke ettiği kapı |
|---|---|---|---|
| Satıcı tüzel kişi, ülke, para birimi, vergi/faturalama | Satıcı ve mali belge gereksinimi formu | Sandbox para birimi TRY; fiyatlar yalnız test verisi | Canlı ödeme ve hukuki metin yayını |
| Sağlayıcı ve ödeme yöntemi | Mevcut entegrasyonun kabiliyet/ücret/abonelik/iade karşılaştırması | Mevcut sağlayıcı adaptörünü incele; yeni sağlayıcıyı varsayma | C04 canlı bağlantı |
| Paket adı, gerçek fiyat, aylık/yıllık, deneme | Yayın önizlemeli paket tablosu | Test paketi açıkça TEST; canlı sayfada uydurma fiyat yok | L03/W02 canlı katalog |
| Ödeme aksaması, iade, dönem sonu ve grace | C05 politika tablosunun işletme tarafından kabulü | Önerilen 72 saat offline grace; ödeme politikası bundan ayrı | G2 canlı ticari kabul |
| İlk satılacak modüller/cihazlar | Desteklenen yetenek listesi | Yalnız Q testlerini geçen özellik satılır | Fiyat ve vaatlerin yayını |
| Marka adı/logo hakkı, satış iletişim adresleri | Mevcut varlık envanteri ve doğrulama | Logoyu rastgele değiştirme; yeni görsel sistemde mevcut işareti kullan | W10/R04 |
| Mobil ödeme modeli ve dağıtım ülkeleri | Mağaza kurallarına göre karar kaydı | M01 teknik deneme yapılır; dış ödeme yönlendirmesi kodlanmaz | M05 |
| Veri saklama ve müşteri verisine destek erişimi | Saklama/silme matrisi, destek erişimi prosedürü | Ticari ve yerel finans verileri otomatik birlikte silinmez | C10/R04 |

## Uygulayıcı için değişmez kurallar

- Integer cents, Argon2id, tenant izolasyonu, append-only audit, gerçek FIFO, prefixed ULID, hata yutma yasağı geçerlidir. Tasarım değişikliği bunların hiçbirini gevşetmez.
- Kullanıcının kirli çalışma ağacını sıfırlama/stash etme/toplu biçimlendirme. Başlangıç durumunu kaydet; izolasyon yöntemini onun çalışmasını koruyacak şekilde seç.
- Frontend yeni görünürken eski motor adaptör üzerinden çalışabilir. Aynı siparişe hem eski hem yeni store üzerinden iki mutasyon gönderme. Eski kod ancak yeni yol kabul edildikten ve referansı kalmadıktan sonra kaldırılır.
- Her görev tek sorumluluk taşır. Ortak sözleşmeyi değiştiren ajan bunu yeni sürüm ve etki listesiyle yapar; diğer ajan sessizce farklı alan adları üretmez.
- Hata düzeltmesi için anlamlı başarısız test önce yazılır; salt renk/boşluk değişimi için aynalama testi üretilmez. Görsel kanıt ve klavye/dokunma kontrolü kullanılır.
- Gerçek müşteri üzerinde ödeme, iade, silme, anahtar yenileme veya deneme siparişi çalıştırma. Q01 test tenant'ı ve sağlayıcı sandbox'ı kullanılır; canlı işlem ayrıca yetkilendirilir.
- Her görevin sonunda ilgili testler, anayasa doğrulamaları ve diff incelenir. “Derlendi” uçtan uca testin yerine geçmez.

## İncelemede özellikle aranacak beş başarısızlık

1. **Güzel ekran, yanlış hak:** Web paketi aktifken cihaz reddediliyor veya kapalı modül IPC ile açılıyor. Kanıt: Q02 paket zinciri ve Q03 yetki matrisi.
2. **İki işlem, tek görünüm:** Yeniden webhook/ödeme tıklaması çift kayıt yaratıyor. Kanıt: C04 tekrar/sıra testleri ve Q04 finans mutabakatı.
3. **Ağ kesilince belirsizlik:** Başarı bildirimi var fakat işlem kalıcı değil veya offline süre yanlış. Kanıt: C07/P04 crash-replay ve Q05 kurtarma.
4. **Tema değişti, ürün hâlâ şablon:** Her modül aynı kart yığını, uzun form ve kaybolan hata. Kanıt: D02 örnek ekran incelemesi, D08 tüm ekran matrisi.
5. **İş bölümü entegrasyonu bozdu:** Farklı API alanı, farklı tenant tanımı, eski exe ile test. Kanıt: C01 sözleşme sürümü, Q01 derleme kaydı ve Q07 teslim kontrolü.

## Tamamlanma nasıl raporlanacak?

Bu planın görev kutuları başlangıçta boştur. Çalışan ajan yalnız kanıt eklediği görevi işaretler. Ana ilerleme tablosunda görev kimliği, uygulayıcı, durum, commit/diff, test kanıtı ve kalan engel tutulur. `Tamamlandı`, `uygulandı fakat doğrulanmadı`, `dış karar bekliyor`, `başlanmadı` ayrı durumlardır.

İlk iş bütün siteyi boyamak değil: **Q01 → C01/C02 → D01/D02 → C03**. Ardından bir gerçek dikey akış bitirilir: Labs'ta paket yayınla → webde satın al → hesapta gör → desktop cihazını bağla → izinli modülü aç → Labs'tan son durumu doğrula. Bu akış geçmeden bütün ekranlara yayılmak entegrasyon borcunu büyütür.
