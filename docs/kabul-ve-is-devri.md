# Kabul testleri ve düşük muhakemeli ajanlara iş devri

> Uygulayıcı: `executing-plans` ile bir görev seç; `verification-before-completion` ile bitir. Güncel dosya sahipliği aşağıdaki çalışma biçimindedir. [Ana plan](uygulama-tamamlama-plani.md) ve görevin bağlı şartnamesi okunmadan kod değişikliği yapma.

**Amaç:** Görevi alan Claude/Codex'in ürün kararı tahmin etmeden çalışması, test edilmemiş değişikliği tamamlandı saymaması ve iki geliştiricinin aynı sınırı farklı uygulamaması.

**Mimari/teknoloji:** Kontrat fixture'ları + birim/servis testleri + gerçek UI ve cihaz kabulü. Mevcut Vitest/Rust testleri korunur; tarayıcı için mevcut altyapı yoksa Playwright tabanlı küçük kabul paketi kurulur. Tauri'ye özel işlemler gerçek native uygulamada ayrıca doğrulanır.

## Her göreve uygulanacak çalışma döngüsü

1. Görevin kimliğini, bağlı görevlerin kanıtını ve dosya kapsamını oku. İlgili mevcut kodu/AGENTS'i kontrol et; eski defter temasını geri getirme.
2. Çalışma ağacı/başlangıç test durumunu kaydet. Kullanıcının değişikliklerini silme, toplu reset/stash yapma, ilgisiz dosyaları biçimlendirme.
3. Görevin davranış senaryosunu ve beklenen sonucu testte ifade et; hata düzeltmesinde testin gerçekten başarısız olduğunu gör. Görsel-only değişiklikte ekran/klavye kanıtı kullan.
4. Tek sorumluluklu en küçük tamamlanabilir değişikliği yap. Bir görevde sözleşme değişirse tüm tüketiciler/compatibility fixture güncellenir veya görev teslim edilmez.
5. Hedef testleri ve gerekli anayasa kontrollerini çalıştır. Başlangıçtan kalan hata ile yeni hatayı ayır; başarısızlığa rağmen “geçti” yazma.
6. İlgili gerçek ekranda normal+hata+yetkisiz/kritik kenar durumu kontrol et. Mock ile API'nin/cihazın gerçek çalıştığını iddia etme.
7. Diff'i incele: secret, any, yanlış tenant, float money, sessiz fallback, gereksiz dosya, eski tema, 500 satır sınırı. Test kanıtı ekle ve ancak sonra görevi tamamlandı işaretle.

## Q01 — Tekrarlanabilir başlangıç ve test ortamı

Bağımlılık: yok; ilk görev. Dosyalar: yeni `docs/acceptance/baseline.md`, `docs/acceptance/fixtures.md`, gerekli test seed araçları (production'da çalışmaz).

- [ ] İki repo için branch/HEAD/dirty listesi, çalışan servis portları, exe/buildId, env isimleri ve DB şema sürümlerini kaydet; env **değerlerini/secret'ları** rapora koyma.
- [ ] Kasam360'daki mevcut çok sayıdaki kullanıcı değişikliğini koru. Yeni dal/worktree gerekiyorsa bu değişikliklerin doğru bazda bulunduğunu doğrula; boş HEAD'den açılan worktree'nin güncel ürün olduğunu varsayma.
- [ ] Mevcut kaynak/build ve şema durumunu kaydet; çalışan uygulama varsa kaynakla eşleşmesini doğrula. Servis çalışmıyorsa bunu açıkça yaz. Henüz bulunmayan ortak kontrat revision'ını Q01'de oluşturma; C01'in çıktısıdır.
- [ ] Mevcut veri modelinde TEST_A/TEST_B için geçici ve tekrar kurulabilir fixture'lar hazırla; mevcut POS rollerini ve aktif/pasif personeli kapsa. Labs'ın mevcut yetkilerini kaydet; henüz uygulanmamış platform rolleri bu görevde istenmez. Mail için bellek içi sink, ödeme için dışarı çıkmayan sentetik olay yeterlidir. Reset yalnız test hedefiyle sınırlandırılır.
- [ ] Mevcut testleri bir kez çalıştırıp sonucu kaydet. Önceden kırık testleri silme; dokunulan görev için nedeni/etkisi yaz. Test sayısını yükseltmek için implementation mirror test üretme.
- [ ] Kabul: fixture kurma/çalıştırma komutları ve kapsamları kayıtlı; geçici veride izolasyon/tekrar kurma kanıtı var; gerçek mail/ödeme veya müşteri DB'sine yazma yok. Mevcut test hataları ve sürüm farkları açıkça kaydedilmiş. Aynı kalıcı DB'yi iki geliştiricinin paylaşması zorunlu değildir.

### Q01 sınırı ve ilerleme kararı — 6 Kasım 2026 düzeltmesi

Q01 mevcut durumun ve güvenli yerel test araçlarının başlangıç kaydıdır. Henüz yapılmamış ürün özelliklerini ön koşul olarak istemez. Önceki metindeki ortak kontrat revision'ı, dört yeni Labs rolü ve gerçek sağlayıcı sandbox şartlarının Q01'e bağlanması bağımlılık döngüsü yaratıyordu; yukarıdaki kapsam bunun yerine geçer.

| Açık iş | Tamamlanacağı görev | Q01/C01 başlangıcını engeller mi? |
|---|---|---|
| Ortak API/IPC şeması, revision ve tüketici uyumu | C01; kimlik/üyelik kısmı C02 | Hayır; C01 bunları üretir |
| Labs billing/auditor rolleri ve fixture'ları | C11/L08; Q03 kabulü | Hayır; mevcut rollerle başlangıç kaydı yeterli |
| Gerçek ödeme sağlayıcısı sandbox'ı | C04; Q02 ticari kabul | Hayır; ilgili entegrasyon kabulünü engeller |
| SMTP teslim/başarısızlık doğrulaması | L07/R03; ilgili destek akışları | Hayır; Q01'de bellek içi sink kullanılabilir |
| Labs ayrı süreç, migration ve HTTP sağlık kabulü | L01/L10; migration güvenliği C12 | Hayır; o süreç testi yapılmış sayılmaz |
| Paylaşılan staging/kabul ortamı | R03; Q02–Q06 ihtiyaçlarına göre | Hayır; tekrar kurulabilir yerel ortam başlangıç için yeterli |
| Satış/vergi/tahsilat/vardiya fixture'larının genişletilmesi | C01 sözleşmesi sonrası C09/Q04 | Hayır; henüz uygulanmamış finans beklentisi uydurulmaz |

Yukarıdaki Q01 başlangıç kanıtı mevcutsa C01 ve D01/D02 başlatılabilir. Q01'i yürütmüş ajan mevcut kanıtları bu düzeltilmiş kapsama eşleyip ilerleme tablosunu günceller; bu belge hiçbir çalıştırılmamış testi başarılı saymaz. Claude'un statik tasarım örnekleri servis entegrasyonunu beklemez; gerçek endpoint/DTO/IPC kullanan uygulama işi C01 kontratını bekler. Sonraki göreve geçiş için sırf yeni rapor üretmek veya zaten geçen aynı testleri tekrar tekrar çalıştırmak gerekmez.

## Ortak test verisi

| Varlık | Değer / beklenen |
|---|---|
| İşletmeler | TEST_A ve TEST_B; farklı tenant ID, sahibi ve cihazı; test isimleri production verisi değil |
| Paket | `Test Paket` published v1; TRY, aylık 100000 cents, cihaz limiti 2; **yalnız test fiyatı**, canlı fiyat önerisi değil |
| Paket sürümü | v2 fiyat 120000 cents, limit 1; v1 abone otomatik yeni fiyata geçmez; downgrade cihaz çözümü ister |
| Özellikler | Testte kds/table_order/recipe_bom/ledger_cari açık; diğer bayraklar kapalı test seti. Her feature ayrıca on/off matrisi |
| Satış ürünü | Birim satış fiyatı 12500 cents; miktar 4 → 50000 cents. KDV snapshot oranı test sözleşmesinde sabit; sonradan değişim eski kalemi etkilemez |
| FIFO lotları | Lot A: 2 adet × 200 cents; Lot B: 3 adet × 500 cents. 4 adet satış maliyeti 1400 cents; B'de 1 adet kalır |
| Tahsilat | Önce 20000 nakit, sonra 30000 kart; toplam 50000, kalan 0; retry aynı sonuç |
| İade | 1 adet için 12500 cents; net tahsilat 37500. Stok geri alma politikası ayrı açık test; iade otomatik PAID iptali değil |
| Vardiya | Açılış nakit 10000; satış nakit +20000, gider -3000 → beklenen nakit 27000; kart 30000. İade bu vardiya fixture'ından ayrı veya etkisi açıkça eklenir |
| Saat | UTC sabit clock; Europe/Istanbul raporu; dönem sonunun hemen öncesi/sonrası, saat geri alma ve gece yarısı |
| Hata | Provider geç webhook, duplicate/old event, API 403/429/500, LAN partition, SQLite transaction crash, disk dolu, bozuk yedek |

ID'ler üretim kuralına uygun prefixed ULID'dir; tabloda TEST_A gibi adlar yalnız fixture etiketidir. Vergi toplam ve satır yuvarlama fixture'ı C01'de ayrıca sabitlenir. Para formatı `1.250,50 TL` gibi yerelleştirilir; hesap formatted string ile yapılmaz.

## Q02 — Ticari uçtan uca kabul

Bağımlılık: C02–C06, L03–L05, W02–W07, P02. Dosyalar: yeni `tests/acceptance/commercial-flow.spec.ts` veya seçilen test harness eşdeğeri; `docs/acceptance/commercial-results.md`.

- [ ] **E01:** Labs taslak paket→yayın→web aynı revision/fiyat/limit→üye ol→TEST_A→quote→sandbox ödeme→web active→desktop aktivasyon→Labs cihaz 1/2. Her geçiş correlationId ile bağlı.
- [ ] **E02:** Checkout dönüşü önce, webhook 60sn sonra. Önce pending, sonra active; tek abonelik ve tek provider ödeme. Sahte success URL entitlement vermez.
- [ ] **E03:** Aynı webhook 5 kez ve eski iptal/aktif olay sırası ters. Beklenen provider son durumuyla aynı; çift hak/tahsilat yok; test olayı canlıyı etkilemez.
- [ ] **E04:** Paket v2 yayınlanır, eski abone v1 kalır; dönem sonu değişikliği önizle; cihaz fazlası çözülmeden geçiş tamamlanmaz. Web/Labs/desktop aynı haklar.
- [ ] **E05:** İptal, dönem sonu, ödeme aksaması, iade, manuel hak bitişi. Erişim C05/C06 tablosuyla aynı; rapor/export gerekli durumda erişilebilir.
- [ ] Kabul: provider sandbox kaydı + Labs DB/olay + API cevabı + web/desktop ekranı birlikte kanıt. Bir ekranın “başarılı” yazması yeterli değildir.

## Q03 — Yetki, tenant ve lisans kabulü

Bağımlılık: C06/C11, P01/P03, L08. Dosyalar: backend/API/Labs security test modülleri; yeni `docs/acceptance/access-matrix.md`.

- [ ] Altı POS rolü × operasyonlar: sipariş, tahsilat, iptal, iade, vardiya, mali rapor, maaş, stock, ayar. UI/menu/route/kısayol/doğrudan IPC için izin/ret matrisi.
- [ ] Dört platform rolü × paket yayın, iade, manuel hak, cihaz iptali, mail gönder, iç not, ekip, secret. Doğrudan HTTP aynı ret sonucu; DB değişikliği yok.
- [ ] TEST_A ile TEST_B kaynak ID'lerini tüm liste/detay/mutasyon/export/ticket/sync uçlarında değiştir. Farklı tenant PIN/lisans/snapshot da reddedilir.
- [ ] Paket bayrağı kapalı; bilinmeyen key; bozuk imza; cihaz limiti yarışması; saat geri alma; session expired; beş yanlış PIN; pasif kullanıcı; manager grant tekrar kullanımı.
- [ ] Kabul: UI görünmezliği tek kanıt değil. Ret cevabı, mutasyon yapılmadığının DB doğrulaması ve audit/olay gerektiren yerde kaydı bulunur. Güvenlik açığı kalmışsa yayın engeli.

## Q04 — Finans ve operasyon kabulü

Bağımlılık: C09, P04–P11. Dosyalar: mevcut Rust finans/stok testlerine ek senaryolar; `docs/acceptance/financial-results.md`.

- [ ] **F01:** Ortak fixture 4 ürün/50000 cents; iki parçalı tahsilat; toplam/kalan/kanal doğru; FIFO yalnız bir kez 1400 cents. Sipariş sonrası ürün fiyat/KDV değişse açık kalem değişmez.
- [ ] **F02:** İki cihaz aynı siparişi aynı anda kapatır. Tek geçerli finans sonucu veya açık çatışma; iki başarılı çift tahsilat yok. Aynı idempotency key tekrarında aynı işlem ID'si.
- [ ] **F03:** Transaction ortasında hata/crash. Sipariş/ödeme/stok/audit ya bütünüyle commit ya hiçbiri; başarı toast'ı commit öncesi yok. Sorgu hatası 0 tutar sayılmaz.
- [ ] **F04:** PAID/CLOSED iptal reddi; yetkili kısmi iade; kalan iade tutarından fazlası reddi; bahşiş cents toplamı tam; negatif modifier reddi.
- [ ] **F05:** Vardiya beklenen nakit 27000/kart30000; kör sayım farkı doğru kanalda; geçmiş/gün sonu/export aynı tarih aralığı. Finansal oran/kar bilinmiyorsa bilinmiyor, uydurma sıfır değil.
- [ ] **F06:** Alış→cari→FIFO→fire→sayım; sayım sırasında satış; reçete döngüsü ve eksik maliyet; kayıtları SQL ile overwrite etmeyen düzeltme. Audit zinciri bağımsız doğrulanır.
- [ ] Kabul: ekran + servis + bağımsız DB toplamı eşleşir; finansal float/fallback taraması yapılır. Salt format testi veya mock-only test yeterli değil.

## Q05 — Offline, yedek ve arıza kabulü

Bağımlılık: C07/C12, P12, R01/R02; mobilde M04. Dosyalar: mevcut LAN/cloud/backup testleri; yeni `docs/acceptance/resilience-results.md`.

- [ ] **O01:** Internet kapalı/LAN açık → iki cihaz yerel operasyon; internet geri → kuyruk bir kez gönderilir. Cloud hata yerel veriyi silmez; UI iki durumu ayrı gösterir.
- [ ] **O02:** LAN ayrışır→iki taraf aynı siparişi tahsil etmeye çalışır. Yalnız kayıtlı işlem otoritesi commit eder; diğer cihaz yeni tahsilat yapamaz. Yeniden bağlanınca aynı sonuç görünür. Ayrı legacy migration fixture'ında eski iki ada ödemesi/audit kayıtları korunarak açık mutabakata alınır; yeni akışta çift tahsilat sonrası uyarı yeterli kabul değildir.
- [ ] **O03:** Süreç commit sonrası UI yanıtından önce kapanır; restart işlem durumunu opId üzerinden bulur. Lisans grace sınırı/clock rollback C06 ile aynı.
- [ ] **O04:** Yeni boş cihazda gerçek yedek restore; tenant, şema, satır sayısı, ödeme/stock toplamı ve audit hash zinciri eşit. Bozuk/yanlış tenant yedek reddi; önceden mevcut DB korunur.
- [ ] **O05:** Mongo hesap kümesi çalışır/işletme kümesi kesik; Labs kesik; provider geç; disk dolu; yazıcı offline. Her durumda hata doğru yüzeyde ve retry tekrar güvenli.
- [ ] **O06:** İmzalı upgrade, imzasız update reddi, yarım migration. İndirilen dosya “başarı” sayılmaz; yeni sürüm açılır ve kayıtlar okunur.
- [ ] Kabul: süreç/ağ/disk arızaları gerçekten uygulanmış veya hangi kısmının simüle edildiği açık; ölçülen kurtarma süresi ve veri sınırı kaydedilir. “Offline demo düğmesi” offline testi sayılmaz.

## Q06 — Görsel, kullanıcı ve performans kabulü

Bağımlılık: D08, L10/W10/P13; mobil M06. Dosyalar: D01 ekran envanteri ve `docs/acceptance/experience-results.md`.

- [ ] Tüm ekranları inventory ile eşle; görülen/tıklanan/servisle doğrulanan ayrımı. Login/lock/modal/drawer/toast/long-form/hata ve empty haller dahil.
- [ ] En az bir ilk kez kullanan kişiyle görevler: fiyatı bul, kayıt/satın al, cihaz kur, ilk ürünü/siparişi oluştur, ödeme al, gün sonunu bul, destek iste. Yardım gereken adımı/yanlış tıklamayı/süreyi kaydet; kişisel veri toplama.
- [ ] Hedefler: temel aksiyon görünür; ilk ürün ve satış yolu rehberle tamamlanır; kritik işlem yanlışlıkla tetiklenmez. Belirli saniye hedefleri pilot cihaz/personel ölçümünden sonra dondurulur, uydurma başarı yüzdesi yazılmaz.
- [ ] WCAG AA kontrolü, Tab/Escape/zoom/reduced motion; desktop hedef çözünürlükleri ve telefon/tablet. Yazı/renk/semantik öğe testleri görsel puanla birlikte.
- [ ] Web Core Web Vitals ve yerel etkileşim hedeflerini ölç; kullanılan cihaz, ağ, veri hacmi ve build kaydı. SEO/GEO içerik denetimi sıralama garantisi değildir.
- [ ] Kabul: kritik görsel/akış hatası açık kalmaz, bütün ekranlarda yeni tasarım dili vardır; yalnız ana sayfa güzelleştirilmiş ürün teslim edilmez.

## Q07 — Görev, entegrasyon ve yayın teslimi

Bağımlılık: her görev sonunda; yayın için Q01–Q06. Dosyalar: yeni `docs/execution-status.md`, görev bazlı kanıt belgeleri.

- [ ] Her görev için aşağıdaki şablonu doldur; tamamlanma beyanı yeni kanıta dayanır. Başka ajanın “bitti” mesajını kontrolsüz kanıt sayma.
- [ ] Ortak kontrat değişikliğini kullanan tüm servisleri aynı staging sürümünde çalıştır; tek repo testinin geçmesi entegrasyon kabulü değil.
- [ ] Kullanıcının istediği iş bölümü sonrası her dosya ailesinin tek yazma sahibi; diğer ajan aynı dosyayı eşzamanlı değiştirmez. Çakışan değişiklik için diff'ler incelenerek bilinçli birleşim.
- [ ] Yayın öncesi R05 somut paket ve kalan riskler listesi; anahtar/mağaza/satıcı gibi dış karar bekleyen işlerin durumu açık. Kanıtı olmayan checkbox boş kalır.
- [ ] Kabul: yeni geliştirici yalnız görev kimliği+belgelerle devam edebilir; ne yapıldığı/ne test edildiği/ne kaldığı belirsiz değil.

## Görev teslim şablonu

```text
Görev: C04 (örnek)
Durum: başlanmadı | sürüyor | dış karar bekliyor | uygulandı/doğrulanmadı | tamamlandı
Bağımlılık kanıtı: C01/C03 dosya ve sürümleri
Değişen dosyalar ve sorumlulukları:
Kontrat/DB değişimi ve eski sürüm uyumu:
Yeni/düzeltilen davranış:
Test komutu + tarih + gerçek sonuç:
UI/cihaz/sandbox kanıtı ve buildId:
Başlangıçtan kalan hatalar:
Kalan engel ve ilgili sonraki görev:
Diff/commit bağlantısı:
```

## Doğrulama komutları

Komutlar belirtilen klasörde ayrı çalıştırılır; secret/env içeriği çıktıya basılmaz. Aşağıdaki liste planlanan doğrulamadır, bu plan yazılırken çalıştırılmış sonuç değildir.

| Klasör | Komut | Beklenen |
|---|---|---|
| `kasam360/backend` | `cargo clippy --lib --tests -- -D warnings` | Sıfır uyarı/hata |
| `kasam360/backend` | `cargo test --lib` | İlgili ve mevcut testler başarılı |
| `kasam360/backend` | `cargo fmt --check` | Format farkı yok |
| `kasam360/desktop` | `npm run test`, ardından `npm run build` | Vitest ve TS/Vite başarılı |
| `kasam360/backend/api` | `npm run test`, ardından `npm run typecheck` | API testleri ve TS başarılı; build script'i varmış gibi çağırma |
| `kasam360/web` | `npm run test`, ardından `npm run build` | Vitest ve Next build başarılı |
| `360labs` | `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` | Repo target'ları doğrulanmış, test/lint/format başarılı |
| Kabul harness | Kurulumda eklenen açık npm script'i | E01–E05 ve ilgili UI senaryoları; script yokken varmış gibi sonuç yazma |

KASAM360 kod değişikliklerinde AGENTS'in zorunlu backend/frontend doğrulamaları eksiksiz uygulanır. Konu dışı mevcut başarısızlık bulunursa başlangıç kanıtıyla raporlanır; kontrol atlanarak yeşil teslim edilmez. Docs-only bu plan için ürün derlemesi gerekmez; belge bağlantıları, görev referansları ve içerik tutarlılığı doğrulanır.

## Güncel çalışma biçimi — 7 Kasım 2026

Kullanıcı Claude’u sınırlı kalan haftalık kotasıyla yeniden dahil etti. Bu teslimde Claude yalnız herkese açık web sayfaları, ortak görsel kabuk ve SEO/erişilebilirlik düzeltmelerini yürütür; yeni tema başlatmaz. Codex cihaz aktivasyonu, V2 lisans ve tenant kapsamlı sync akışını backend/API, Labs ve desktop üzerinde tamamlar; bu teslim sırasında web dosyalarını değiştirmez. Claude hesap/auth/destek iş mantığına, backend/API, Labs, desktop, bağımlılık ve kilit dosyalarına dokunmaz. Ortak CSS değişikliklerinde hesap/auth/destek ekranlarının görsel kontrolü yapılır. Mevcut değişiklikler korunur. İlerleme tablosunun tek yazarı Codex; Claude teslim kanıtını kullanıcıya sunar. İki teslim sonrası ortak kabul yapılmadan bütünleşik tamamlanma iddiasında bulunulmaz.

İşler çalışan kullanıcı akışları halinde tamamlanır. Gerekli API, frontend ve test değişiklikleri aynı teslimde ele alınabilir; görev numarası veya eksik ilgisiz envanter tek başına ilerleme engeli değildir. Bir sabit, tip veya belge değişikliğinden sonra tur sonlandırılmaz; anlamlı akış tamamlanana veya kullanıcı girdisi gerektiren gerçek engel çıkana kadar devam edilir. Kısa ilerleme bilgisi vermek çalışmayı durdurma nedeni değildir.

Hız için gereksiz refactor, yeniden planlama, yeni rapor ve tekrarlı test koşuları yapılmaz. Finans, tenant/rol güvenliği, veri bütünlüğü ve zorunlu derleme/test kontrolleri korunur. İlgili kontrat kodla birlikte güncellenir; mock gerçek servis gibi sunulmaz. Testi geçen bir kapsam, daha geniş görevin tamamlandığı şeklinde işaretlenmez.

## Eski bulguların yeni görevlerle kapanışı

| Bulgular | Kapatacak görev ve kanıt |
|---|---|
| B01/B10/B12 | C03–C05, L03, W02/W04–W06, Q02 ticari zincir |
| B02/B03/B04/B05 | C06/C07, P01/P12, Q03/Q05 lisans ve bulut |
| B06 | R01/R02, O06 kurulum/update |
| B07 | Q01/L01/L10 build eşitliği |
| B08 | P01/P05/P11, F05 vardiya mutabakatı |
| B09/B16 | C08/L09/P11/W08 kalıcı uyarı |
| B11 | C04/L05, E03 test/canlı ayrımı |
| B13/B14 | P12 QR; P08 sayım; ilgili yetenek testleri |
| B15 | L02/L09 işletme sağlık görünümü |
| B17/B19/B20 | D03/D05/D07, P07/P11/P12 görsel/durum kabulü |
| B18 | W01/W03 header oturum testi |
| B21 | C10/W09, silme/saklama/restore testleri |
| B22 | P01/P03 MASTER sınırı ve Labs yönü |
| B23 | C07, Q04/F02 ve Q05/O02; LAN bölünmesinde ikinci tahsilatın baştan reddi ve eski ada kayıtlarının korunması |

Yeni bulunan hatalar eski B numaralarını yeniden kullanmaz; yeni bulgu kaydı açılır ve ilgili göreve bağlanır. Bu harita bütün hataların bilindiği iddiası değildir; envanter, negatif testler ve pilot ek eksikleri ortaya çıkarmak için vardır.

## Planın kendi incelemesi — 6 Kasım 2026

`brainstorming` becerisinin bağımsız uygulayıcı kontrolü yapıldı. İlk okumada altı önemli belirsizlik bulundu: LAN bölünmesinde finansal otorite, eski entitlement ile lease uzatma, görev döngüleri, yerel OWNER/personel sahipliği, kapalı feature'da geçmişe erişim ve kurtarma kanıtı. Belgeler bu noktalarda güncellendi; ikinci okumada önemli açık soru bildirilmedi. Bu sonuç planın okunabilirlik/tutarlılık incelemesidir, ürünün güvenlik veya çalışma testi değildir.

Güncel teslim biçimi: bir çalışan akışı belirt, ilgili mevcut kod ve sözleşmeyi oku, gereken katmanları birlikte tamamla, ilgili kontrolleri çalıştır ve kısa kanıtla teslim et. Q01 tamamlandığı için başlangıç envanterini yeniden üretme. Ayrıntılı görev listesi kontrol kaynağıdır; her checkbox için kullanıcıdan yeni talimat bekleme.
