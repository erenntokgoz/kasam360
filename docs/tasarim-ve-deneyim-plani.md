# Tasarım ve deneyim uygulama planı

> Uygulayıcı: `executing-plans`, `frontend-accessibility-best-practices` ve `web-design-guidelines` kullan. Ana belge: [tamamlama planı](uygulama-tamamlama-plani.md). Bu dosya yeni görsel sistemin şartnamesidir; uygulanmış tasarım değildir.

**Amaç:** İlk bakışta ayırt edilen, yoğun kullanıldığında yorulmayan ve her durumda güven veren bir ürün ailesi.

**Mimari/teknoloji:** Semantik tasarım token'ları + uygulamaya göre kompozisyon + ortak davranış sözleşmesi. Desktop React/Tailwind, web Next/GSAP, Labs mevcut Rust HTML/CSS/JS yapısı üzerinde yeni arayüz. Aynı CSS sınıfını üç depoya kopyalamak yerine sürümlü token kaynağı ve davranış örnekleri kullanılır.

## Tasarım yönü: hassas, sakin, işe ait

KASAM360 bir restoranın yoğun anında kullanılan çalışma aracıdır. Kimlik, jenerik dashboard dekorundan değil; net rakamlardan, belirgin sipariş alanından, hızlı seçimden, gerçek ürün görüntülerinden ve tutarlı durumlardan gelecek. Defter/kağıt/el yazısı yok. Rastgele mor gradyan, cam kart, her yerde yuvarlak kapsül, dev karşılama ve anlamsız grafik yok.

Üç yaklaşım değerlendirildi: (a) nötr SaaS kart düzeni kolaydır fakat mevcut sıradanlık sorununu tekrarlar; (b) koyu, gösterişli restoran atmosferi webde güçlü olabilir fakat gün boyu POS kullanımını ve Labs taramasını ağırlaştırır; (c) **önerilen hassas operasyon dili**, güçlü tipografi ve kontrollü marka vurgusunu işleve göre farklı kompozisyonlarda kullanır. Uygulama teması açık/koyu seçilebilir; iki temada aynı bilgi hiyerarşisi korunur.

Markayı ayırt edecek somut imza renk seçiminin ötesindedir: iri, sıkı dizilmiş başlıklarla sakin yardımcı metin; belirgin hizalanmış para sütunları; boşlukla ayrılan düz çalışma yüzeyleri; yalnız aktif işi vurgulayan ince renk işaretleri; gerçek salon ve sipariş verisinden üretilen ürün sahneleri. Webin ana hareketi bir masanın siparişinin mutfağa ve kasaya ilerlemesini anlatır; sayfa aşağı kaydıkça rastgele kart uçuşmaz. Desktopta aynı ilişki masa seçimi, sipariş satırı vurgusu ve mutfak durumu değişimiyle görünür. Labs'ta bu dil zaman çizelgesi ve sorun→çözüm ilişkisine dönüşür.

D02'de örneklerin üstünden logo kapatılarak bakılır: yalnız logoyla ayırt ediliyorsa tipografi/yerleşim/ürün sahnesi yeniden çalışılır. Hazır bir dashboard starter kit'inin kart ve boşluk düzeni nihai tasarım kabul edilmez. Bununla birlikte kullanıcı alışkanlığını bozan sıradışı ödeme, form veya klavye davranışı “özgünlük” adına eklenmez.

Webde geniş anlatı ritmi ve ürün sahnesi; desktopta sık kullanılan çalışma alanı; Labs'ta aranabilir yoğun kayıt ve olaylar. Üçü de aynı logoyu, tipografik karakteri ve semantik durum renklerini taşır. Her sayfayı aynı kutulara bölmek yasaktır; aşağıdaki kompozisyonlar esas alınır.

## Başlangıç token şartnamesi

Bu değerler uygulayıcının tahmin etmemesi için başlangıç yönüdür. D02 örneklerinde kontrast ve cihaz kontrolü sonrası tek kaynaktan düzeltilebilir; henüz kullanıcı tarafından görsel olarak onaylanmış palet değildir.

| Token grubu | Açık tema başlangıcı | Koyu tema başlangıcı / kullanım |
|---|---|---|
| Canvas | `#F2F4F7` | `#111820`; uygulama zemini |
| Surface | `#FFFFFF` | `#1A2430`; içerik ve düzenleme |
| Surface muted | `#E8EDF2` | `#233140`; seçilmemiş ikincil alan |
| Text primary | `#172332` | `#F3F6FA`; başlık/değer |
| Text secondary | `#526173` | `#B5C2CF`; açıklama, asla devre dışı gibi soluk değil |
| Border | `#CAD3DE` | `#425365`; yüzeyleri ayırma, her kutuyu çevreleme değil |
| Brand/action | `#174EA6` | `#A9C8FF`; koyu temada koyu yazı; etkileşim rengi |
| Accent | `#D79A31` | `#E5AF50`; web vurgu alanı, küçük metin rengi olarak varsayma |
| Success/warning/danger | Ayrı foreground/background/border üçlüleri D02'de ölçülür | Durum yalnız renkle anlatılmaz; ikon + metin |
| Focus | 2px dış hat + 2px boşluk | Her yüzeyde görünür, hover'dan farklı |
| Radius | Alan 8px; panel/dialog 12px; kapsül yalnız badge | Bütün arayüzü baloncuklaştırma |
| Spacing | 4/8/12/16/24/32/48/64px | Sık operasyon 8–16; rapor 16–24; web 32–96 |
| Shadows | Surface düz; popover düşük; dialog orta | Hiyerarşiyi gölge sayısıyla kurma |

Yazı: mevcut Schibsted Grotesk'i self-host Türkçe karakter kontrolüyle değerlendir; gövde 16/24, yoğun tablo 14/20, etiket 13/18, başlık 24/30, kritik toplam 32/38. Desktopta 12px altı işlevsel metin yok. Tüm fiyat/saat/sayaçlarda tabular nums. El yazısı font bağımlılığını kullanım kalmadığında kaldır. Web başlıkları 40–72px aralığında akışkan; mobilden taşmayacak. Labs listelerinde yoğunluk seçimi olabilir, dokunma hedefi en az 48px kalır.

## Sayfa kompozisyonları

| Yüzey | Yerleşim | Birincil odak | Kaçınılacak düzen |
|---|---|---|---|
| Desktop kabuk | Metinli sol menü; modül başlığı; yerel araç satırı; çalışma alanı | Aktif modül ve kullanıcı bağlamı | Her modülde tekrar logo/karşılama; iç içe üç sekme şeridi |
| Salon | Bölge seçimi + taranabilir masa alanı + seçili masanın sağ özeti | Masa durumu, geçen süre, tutar | Her masada aynı genel kayıt kartı |
| POS | Kategori/arama + ürün alanı + sabit genişlikte sipariş ve tahsilat alanı | Sipariş satırı ve toplam | Ödeme düğmesinin sayfa altında kaybolması |
| Kasa | Vardiya şeridi + nakit/kart özeti + hareket tablosu + belirgin kapanış | Mutabakat | Beş aynı boy KPI kartının asıl işi aşağı itmesi |
| KDS | İstasyon filtresi + durum kolonları/kuşakları + yaşlanan biletler | Öncelikli sipariş | Finans/ayar kartlarının mutfağa taşınması |
| Ürün/stock düzenleme | Sol ana form; sağ fiyat/reçete/özet; sabit işlem altlığı | Kaydetmenin etkisi | Dar uzun sütun ve boş sağ yarı |
| Rapor | Dönem/filtre + tek ana görsel/özet + ayrıntılı tablo | Karşılaştırma ve kayıt kanıtı | Süs grafik, sıfır veriden yüzdelik başarı |
| Ayarlar | Sol kategori listesi + bölümlü okunabilir içerik | Tercih, bağlı cihaz ve sağlık | Her ayarın ayrı dev kart olması |
| Labs genel bakış | Acil işler + işletme araması + son olaylar | Müdahale gerektiren sorun | Gösterişli fakat işlem açmayan istatistikler |
| Labs işletme | Kimlik başlığı + durum özeti + sekmeli detay + zaman çizelgesi | Kimin ne sorunu olduğu | Kullanıcı/işletme/abonelik ayrımını gizleme |
| Web ana sayfa | Tipografik giriş + gerçek ürün sahnesi + senaryolar + paket + güven | Ürünü anlama ve başlama | Genel stok fotoğraf/AI illüstrasyonuyla gerçek ürünü saklama |
| Web hesap | İşletme seçimi + sonraki adım + abonelik/cihaz/destek navigasyonu | Kuruluma veya çözüme ilerleme | Profil kartından ibaret portal |

Desktop 1280×800 ve 1366×768 ilk hedef; 1024×768 minimum operasyon kontrolü, 1920×1080 geniş alan dengesi. Web 360/390/768/1280/1440; mobil 360–430 telefon ve 768–1024 tablet. 200% yakınlaştırmada kritik aksiyon kaybolmaz; tüm sayfa yatay kaydırılmaz, gerekiyorsa yalnız veri tablosu kayar.

## D01 — Ekran ve davranış envanteri

Bağımlılık: Q01. Dosyalar: yeni `docs/design/screen-inventory.md`, `docs/design/decisions.md`; mevcut `desktop/src/app/App.tsx`, `desktop/src/ui/*`, `web/src/app/*`, `360labs/src/pages.rs` okunur.

- [ ] Tüm route, menü, alt sekme, klavye kısayolu, modal/drawer çağrısını çıkar; raporda görünmeyenleri ekle. Her satır: uygulama/rol/paket/giriş noktası/veri kaynağı/aksiyon.
- [ ] Her ekran için normal, yükleniyor, boş, doğrulama hatası, sunucu hatası, yetkisiz, offline, uzun veri durumlarını işaretle; uygulanmayan duruma gerekçe yaz.
- [ ] Eski tema sınıfları/font/varlık bağımlılıklarını listele; silinecek görsel ile korunacak iş davranışını ayır.
- [ ] Çıktı: hiçbir menü/kısayol sahipsiz değil. Kabul: route ağacı ile envanter satırları birebir karşılaştırılır; “ve diğer ekranlar” bırakılmaz.

## D02 — Önce görsel örnek seti, sonra bütün ekranlar

Bağımlılık: D01. Dosyalar: yeni `docs/design/tokens.json`, `docs/design/component-contracts.md`, `docs/design/specimens/`; uygulayıcı gerçek render örnekleri üretir.

- [ ] Aynı gerçekçi test verisiyle 7 örnek oluştur: web hero+paket, web hesap, desktop login, lock, POS, ürün formu, Labs işletme detayı. Açık/koyu ve dar görünümü ekle.
- [ ] Login'de marka alanı en fazla yaklaşık %40, form alanı odak; Google/e-posta ayrımı, görünür etiket, parola göster, hata inline. Kişisel veri içeren işletme durumu giriş öncesi açılmaz.
- [ ] Lock'ta tam ekran sade kullanıcı/işletme bağlamı, PIN alanı ve 48px+ tuşlar; saat dekoru PIN'i bastırmaz. PIN'i doğrulanan personel aktif olur; “kasayı kapat” ile “kilidi aç” karışmaz.
- [ ] POS ve Labs için dolu listeler kullan: 30+ ürün, uzun Türkçe adlar, 7 haneli tutar, başarısız bağlantı. Sadece boş ekranla kalite kararı verme.
- [ ] Renk/kontrastı ölç; normal metin 4.5:1, büyük metin ve arayüz bileşenleri ilgili WCAG AA eşikleri. Ölçülmeyen renge “erişilebilir” deme.
- [ ] Kullanıcıya 7 render ve kısa tasarım gerekçesi sunulabilir hale getir. Sonraki bütün ekranların üretiminden önce somut örnekler üzerinden yön netleşir; soyut “modern olsun” onayı istenmez.
- [ ] Kabul: farklı görevlerin farklı kompozisyonu görülür, defter izi yoktur, dar ekran kullanılabilir. Yalnız Tailwind class değişiklikleri veya moodboard teslim sayılmaz.

## D03 — Token ve temel bileşen katmanı

Bağımlılık: D02 yönü kesinleşmiş. Dosyalar: `desktop/src/index.css`, `desktop/src/notebook.css`, `desktop/src/ui/{Button,Input,NumberInput,Bar,Badge,Card}.tsx`, `web/src/app/globals.css`, `360labs/assets/style.css`; yeni `desktop/src/ui/DataState.tsx`.

- [ ] Token'ları semantik adlarla tanımla; `.paper/.sheet` bağımlılıklarını ekran geçişi boyunca geçici adaptöre al, son kabulde kaldır. İşaretleme içinde yeni ham renk üretme.
- [ ] Button: primary/secondary/quiet/danger ve loading/disabled; Input: label/hint/error/required; NumberInput: locale gösterimi, integer cents dönüşümü ve sınır hatası.
- [ ] Tab, navigasyon linki, işlem düğmesi, seçilebilir satır ve metrik birbirinden görsel ve semantik ayrılır. Tıklanmayan karta ok/hover verme.
- [ ] `DataState`: loading/empty/error/partial/stale için ayrı içerik; hata durumunda sıfır tutar gösterme. Yenile eylemi eski sonucu korurken açık yüklenme verir.
- [ ] Kabul: bileşen galerisi klavye, ekran okuyucu isimleri, koyu tema, 200% zoom, uzun Türkçe metin ve dokunma ile denenir. UI testleri davranışı kontrol eder; CSS değerlerini kopyalayan test yazılmaz.

## D04 — Modal, drawer ve tehlikeli işlem standardı

Bağımlılık: D03. Dosyalar: `desktop/src/ui/{Modal,Drawer,ConfirmDialog,PinpadModal,useFocusTrap}.tsx`; eşdeğer web/Labs bileşenleri.

- [ ] Kısa onay 420–480px, orta form 640px, ayrıntı 880–960px; viewport kenarında en az 16px pay. Başlık ve işlem altlığı sabit, yalnız içerik kayar.
- [ ] Tek overlay stack: backdrop 100, dialog 110, iç popover 120, bildirim 130; modal açıkken arka içerik inert. İç modal sayısını mümkünse birde tut; onay alt akışını aynı yüzeyde sun.
- [ ] Escape sadece en üst katmanı kapatır; odak alanındayken farklı davranmaz. Kirli form kapatılmadan değişiklik uyarısı; finansal işlem sürerken kapatma güvenli durum açıklamasıyla engellenir.
- [ ] Dış tıklama sadece salt okunur detayda kapatır; düzenleme/ödeme/onay yüzeyinde kapatmaz. Açılış odağı ve kapanınca tetikleyiciye dönüş tanımlı.
- [ ] Tehlikeli onayda etkilenen kayıt, sonuç ve geri alınabilirlik açık; finansal PIN yetkisi Rust tarafında doğrulanır. Her sıradan kaydetmede gereksiz onay ekleme.
- [ ] Kabul: iç seçim açıkken Escape önce seçimi kapatır; Tab dışarı kaçmaz; uzun formda Kaydet görünür; çift gönderim tek mutasyon; hata sonrası form verisi korunur.

## D05 — Bildirim ve hata dili

Bağımlılık: D03, C08. Dosyalar: `desktop/src/ui/{OperationNotice,ErrorToast}.tsx`, `desktop/src/notice.css`; web/Labs bildirim yüzeyleri.

- [ ] Başarı toast'ı 4sn, bilgi 6sn; odak/hover süreyi durdurur. Kritik hata toast'a bırakılmaz: ilgili alanda veya kalıcı durum panelinde çözülene kadar kalır.
- [ ] En çok 3 görünür toast; tekrar `eventCode+entityId` ile gruplanır. Ödeme/kurulum CTA'sını örtmeyen bildirim alanı; küçük ekranda sabit toplam/alt aksiyon üzerinde yığılmaz.
- [ ] Metin şablonu: “Ne oldu?” + “Veriye/işleme etkisi” + “Sonraki eylem”. Örnek: “Buluta gönderim durdu. 2 işlem bu cihazda kayıtlı. Bağlantıyı incele.” Nedeni bilinmiyorsa lisans hatası diye tahmin etme.
- [ ] Alan doğrulaması alan yanında; genel form hatası form üstünde; sistem sorunu uygulama durum alanında. `aria-live=polite`; yalnız acil engel için assertive, her render'da tekrar okuma yok.
- [ ] Kabul: “Kaydedildi” ancak sunucu/yerel transaction başarısından sonra çıkar; çözümlenmemiş hata 12sn sonra yok olmaz; bildirimi okumak sorunu çözülmüş yapmaz.

## D06 — Hareket tasarımı

Bağımlılık: D03. Dosyalar: `desktop/src/motion.css`, `desktop/src/lib/motion.ts`, web GSAP bileşenleri; Labs `assets/panel.js`.

- [ ] Desktop: basma/selection 80–120ms, panel/dialog 140–180ms, opacity/transform. Toast dönmesi ve tüm çocuklara otomatik animasyon kaldırılır. Ürün ekleme veriyi bekletmez; toplam her karede zıplamaz.
- [ ] Web: hero ürün sahnesinde en fazla bir ana hareket, bölüm girişleri 180–300ms, kullanıcı kaydırmasını kilitlemeyen geçişler. Bir ürün senaryosunu anlatan kısa etkileşim; sonsuz dikkat dağıtan loop yok.
- [ ] Labs: satır güncellendi vurgusu ve panel geçişi; kayıtların tamamını sıralı animasyonla bekletme. İşlem durumunu spinner tek başına anlatmaz.
- [ ] Reduced motion'da dekoratif hareket kapalı; içerik JS/animasyon yüklenmeden görünür. Görünmeyen sahneler durdurulur; layout ölçümü her scroll olayında zorlanmaz.
- [ ] Kabul: düşük donanımlı hedef POS'ta kayıtlı ölçüm; normal etkileşimde hedef 16.7ms kare bütçesi, uzun görevler raporlanır. Ölçülmeden “60fps” yazılmaz. Web performans bütçesi W10'da.

## D07 — Metin, boş durum ve kullanıcı hissi

Bağımlılık: D01/C05. Dosyalar: yeni `docs/design/content-guide.md`; ilgili ekran metinleri.

- [ ] Tek sözlük: web hesabı/işletme/personel/cihaz/abonelik/lisans ayrı isimlerle anlatılır. Kullanıcıya IPC, tenant, webhook, BCG gibi terimler açıklamasız gösterilmez.
- [ ] Boş durum her zaman “neden boş” ve yetkiliyse “ilk adım” taşır. Rapor için satış yok ile veri okunamadı ayrıdır. Yetkisiz personele yapamayacağı işlem düğmesi sunulmaz.
- [ ] Kurulum eksikleri eylem listesi: ürün ekle, istasyon ata, yazıcı dene. Maliyet eksikse “Analiz için ürün maliyetlerini tamamlayın”; teknik hata toast'ı değil.
- [ ] Lisans/bağlantı mesajı paniğe sürüklemez; yerel satışın çalışıp çalışmadığını açık söyler. İşlem bekliyor durumunda yeniden ödeme çağrısı yok.
- [ ] Kabul: her ana yolun ilk kez kullanan kişiyle görev testi; açıklama okumadan bulunamayan aksiyon kaydedilir. Görüşler ile ölçülen görev başarısı ayrı raporlanır.

## D08 — Bütün ekranların görsel kabulü

Bağımlılık: D03–D07 ve ilgili ekran görevi. Dosyalar: yeni `docs/design/visual-acceptance.md`, `docs/design/evidence/`.

- [ ] D01 satırlarının her biri için dolu/boş/hata, açık/koyu ve hedef ekran görüntüsü kaydet; dosya adı ekran-durum-boyut. Gerçek müşteri verisi kullanma.
- [ ] Otomatik erişilebilirlik taraması + elle Tab/ShiftTab/Escape/Enter/zoom/reduced-motion kontrolü yap; otomatik testin geçmesi tek başına kabul değil.
- [ ] Her ekranı 0–2 ile puanla: hiyerarşi, yerleşim, marka özgünlüğü, okunabilirlik, durum açıklığı, aksiyon bulunabilirliği, tutarlılık, küçük ekran. Kritik ekranlarda hiçbir madde 0 olamaz; toplam en az 14/16 hedef.
- [ ] Giriş, kilit, ödeme, ürün formu ve Labs işletme ekranlarında birincil eylem ilk bakışta seçilir; uzun form butonu sabit; kartın içine kart zinciri yok; veri kesiliyorsa tam içeriğe klavyeyle erişim var.
- [ ] Kabul: tüm satırlar incelenmiş ve açık kusurlar listelenmiş. Sonuç “AI slop değil” gibi öznel slogan değil, karşılaştırılabilir görseller ve görev başarısı kanıtıdır.

## Çini token'ları ve cam kuralı

Desktop ve mobil aynı token dosyasını (`desktop/src/index.css`) kullanır; web ayrıdır. Renkler yalnız semantik token'dan gelir: `--base`, `--surface`, `--hover`, `--line` (süs ayırıcı), `--edge` (denetim kenarı), `--text`, `--muted`, `--action`, `--ok`, `--warn`, `--danger`. Bileşende hex veya ham Tailwind renk sınıfı kullanılmaz.

- Açık: zemin #EDF2F1, yüzey #FFFFFF, kenar #78908C, metin #14211F, ikincil #4A5C5A, vurgu #0A6B68, başarı #1B6B3A, uyarı #8A5A00, tehlike #B3261E.
- Koyu: zemin #0C1514, yüzey #142120, kenar #4F706D, metin #EAF3F2, ikincil #A6BDBA, vurgu #5CD1C8, başarı #6FD39A, uyarı #F0B650, tehlike #FF8A80.
- Ölçüm: denetim kenarı yüzeyde 3,41:1 (açık) ve 3,05:1 (koyu); bu yüzden değiştirilmedi. Metin zeminde 14,7:1, vurgu beyaz üzerinde 6,3:1.
- Yazı tipi: Archivo, yerel paketten (`@fontsource-variable/archivo`), yalnız latin ve latin-ext, tek ağırlık aralığı; CDN yok.
- Cam yalnız çerçevede: kenar çubuğu, üst çubuk, alt sekme, modal ve çekmece paneli (`.glass-panel`). Kart başlıkları yalnız yarı saydam tondur, bulanıklık almaz. Kasa defteri, rapor tablosu, sipariş kalemi, KDS ve panel içeriği düz opak yüzeydedir.
- Performans: bulanıklık en çok 3 sabit katmanda (kenar çubuğu veya alt sekme, üst çubuk, açık panel; panel içindeki çubuk ve iç içe panel bulanıklık açmaz), `--glass-blur` 12px, kaydırılan listede ve satırda yok, `will-change` yok, tek katmanlı gölge. `@supports not (backdrop-filter)`, `prefers-reduced-transparency` ve `data-perf="low"` opak yüzeye döner. `data-perf="low"`: Android'de `deviceMemory` ≤ 4 veya `hardwareConcurrency` ≤ 4 (`lib/perfMode.ts`); `localStorage` `kasam360.perf=low` ile elle zorlanır.
- Bu adımda yerleşim, akış ve hareket değişmedi; `.paper/.sheet` adları geriye uyumluluk için düz yüzeye eşlenmiştir.

Kontrol dayanağı: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Görsel yön tasarım önerisidir; erişilebilirlik ve davranış ölçütlerinden ayrı değerlendirilir.
