# Web sitesi ve müşteri portalı uygulama planı

> Uygulayıcı: `executing-plans`, `frontend-accessibility-best-practices`, `web-design-guidelines`. [Ana plan](uygulama-tamamlama-plani.md), [tasarım](tasarim-ve-deneyim-plani.md) ve [kontratlar](sozlesmeler-ve-backend-plani.md) birlikte uygulanır.

**Amaç:** Ürünü güvenilir biçimde anlatan, aramada anlaşılabilen, satın almayı ve kullanıma başlamayı bitiren yepyeni web deneyimi.

**Mimari/teknoloji:** Mevcut Next.js/TypeScript uygulamasında yeni sayfa kompozisyonları. Public içerik server-rendered; kişisel hesap ve ödeme cevapları ortak cache'e girmez. GSAP yalnız anlatı için; temel metin ve bağlantı JS çalışmasa da erişilebilir. Backend iş mantığı Hono/Labs sözleşmesindedir.

**Dosya yolu kuralı:** Kısaltılmış `app/`, `components/`, `content/`, `lib/` yolları `kasam360/web/src/` altındadır. Yeni route'lar tam bu dizinin app ağacına eklenir. Auth/API değişiklikleri ayrıca belirtilen `kasam360/backend/api/src/` içindedir; web içine ikinci kimlik/ödeme backend'i kurulmaz.

## İçerik ve route haritası

Mevcut public adresleri koru; slug değişirse 301 ve canonical haritası hazırla. Yeni özel sayfalar aşağıdaki hedeflerdir; `/hesabim` müşteriye ait portalın girişidir.

| Route | İş ve içerik |
|---|---|
| `/` | Açık ürün cümlesi, gerçek uygulama sahnesi, üç kullanım senaryosu, güven kanıtı, paket özeti, SSS, başlama |
| `/ozellikler` | Operasyon modülleri; platform ve paket durumları, gerçek ekranlar, offline sınırları |
| `/abonelik` | Canlı paketler, aylık/yıllık varsa seçim, toplam/vergi, cihaz limiti, dahil/haric özellik, karşılaştırma |
| `/sorular` | Kurulum, internet, cihaz, personel, ödeme, iptal, veri/yedek soruları; gerçek cevaplar |
| `/iletisim` | Satış iletişimi, mevcut müşteri desteğine doğru yönlendirme, çalışma saatleri doğrulanmışsa |
| `/indir` (yeni) | Desteklenen OS, sürüm/tarih, imzalı yükleyici, sistem gereksinimi, kurulum rehberi; yalnız yayımlanan platform |
| `/giris`, `/kayit` | Google/e-posta; doğrulama, dönüş bağlamı, sözleşme/izin metinleri |
| `/sifremi-unuttum`, `/sifre-yenile` | Güvenli reset; expired/used/invalid token, yeniden isteme |
| `/hesabim` | İşletme seçimi, kurulum/abonelik/cihaz durumuna göre bir sonraki adım |
| `/hesabim/isletmeler` (yeni) | Üyelik kapsamı, işletme oluşturma, bilgiler, yetkili üyeler |
| `/hesabim/abonelik` (yeni) | Paket, dönem, ödeme durumu, değişiklik önizleme, dönem sonu iptal |
| `/hesabim/odemeler` (yeni) | Tahsilat geçmişi, sağlayıcı makbuzu veya doğrulanmış fatura bağlantısı |
| `/hesabim/cihazlar` (yeni) | Aktif cihazlar, limit, son bağlantı, isim ve iptal/eşleme |
| `/hesabim/bildirimler` (yeni) | Kalıcı ödeme/lisans/destek uyarıları |
| `/hesabim/guvenlik` (yeni) | Bağlı giriş yöntemleri, oturumlar, parola/hesap silme ve export yönlendirmesi |
| `/destek` | Girişli kullanıcı ticket listesi/detayı/oluşturma; girişsiz kullanıcıya güvenli giriş |
| `/odeme/sonuc` (yeni) | Bekleniyor/başarılı/başarısız/iptal; sunucudan teyit, güvenli tekrar |
| Mevcut gizlilik/KVKK/şartlar/iade | Gerçek veri, abonelik, saklama ve destek modeliyle güncel metin |

## W01 — Yeni vitrin ve ürün hikâyesi

Bağımlılık: D02, desteklenen ürün kapsamı. Dosyalar: `web/src/app/{page,layout}.tsx`, `components/{SiteHeader,SiteFooter}.tsx`, `content/siteConfig.ts`; yeni `components/marketing/{Hero,ProductWalkthrough,UseCases,TrustSection}.tsx`.

- [ ] İlk ekranda kimin için hangi iş çözüldüğünü tek açık cümleyle anlat; ana CTA “Paketleri incele”, ikincil “Ürünü gör”. Satış görüşmesi mevcut süreçse eklenir; olmayan demo hizmeti vaat edilmez.
- [ ] Gerçek yeni desktop ekranını ürün sahnesi yap; sipariş alma→mutfağa iletme→tahsilat→gün sonu anlatısını kısa etkileşimle göster. Sahte müşteri logosu, sayı, yorum, rozet yok.
- [ ] Bölümler farklı ritimde: tipografik giriş, geniş ürün sahnesi, kısa senaryo, ekran yakın planı, fiyat, cevaplar. Her şeyi üç sütun ikon kartına dönüştürme.
- [ ] Header oturumu bilir: girişsiz “Giriş / Başla”; girişli “Hesabım”. Mobil menü odak ve Escape yönetimi, sticky header anchor içeriği örtmez.
- [ ] Eski `PadStack/PageSheet/sheets` görsel bağımlılıklarını yeni sayfalar kabul edilince kaldır; mevcut SEO adreslerini ve gerekli auth davranışını koru.
- [ ] Kabul: ana CTA kayıt/paket akışına gider; ekran görselleri gerçek sürümü temsil eder; reduced-motion ve JS kapalı temel içerik kontrol edilir.

## W02 — Paket karşılaştırma ve satın almaya giriş

Bağımlılık: C03, L03. Dosyalar: `web/src/app/abonelik/page.tsx`; yeni `components/billing/{PackageGrid,PackageComparison,PriceSummary}.tsx`, `lib/catalogApi.ts` ve testleri.

- [ ] Katalog sunucudan; isim/fiyat/feature/limit hardcode edilmez. Yayımlanmış revision gösterim/telemetride izlenir. Katalog hatası boş paket veya sıfır fiyat olmaz.
- [ ] Dönem seçimi, para birimi/vergi açıklaması ve cihaz sayısı görünür. Yıllık toplamı gizleyip yalnız aylık eşdeğeriyle satış yapma; indirim varsa hesap sunucuda.
- [ ] Feature tooltip'leri gerçek sınırı anlatır: QR görüntüleme/sipariş, LAN/bulut, cihaz/şube farkı. Kapalı modül dahil görünmez.
- [ ] CTA oturuma göre kayıt/giriş veya işletme seçimi ve quote'a gider. Seçili priceId güvenli return context ile korunur; dönüşte yayından kaldırıldıysa yeniden seçim istenir.
- [ ] Kabul: Labs yeni fiyatı yayınlayınca eski cache kontrollü yenilenir; seçilen/eski price version checkout'ta açıkça doğrulanır; 360px'de karşılaştırma ve fiyat anlaşılır.

## W03 — Üyelik, Google ve hesap güvenliği

Bağımlılık: C02/C11, D03–D05. Dosyalar: `components/account/{LoginForm,RegisterForm,PasswordForms,FormParts}.tsx`, `lib/authApi.ts`; ilgili route'lar; API auth testleri.

- [ ] Yeni auth kompozisyonu; görünür etiket, password manager/autocomplete, submit loading, alan hatası ve retry. Başarılı form sonrasında doğru return context'e yönlendir.
- [ ] Google'ı temiz oturumda baştan sona test et; iptal/sağlayıcı hatası, mevcut e-posta çakışması ve hesap bağlama. Açık Google oturumu görmek başarı testi değildir.
- [ ] E-posta doğrulama, tekrar gönderme süresi, expired OTP/reset token, tek kullanımlılık. Bilinmeyen e-posta için hesap varlığını gereksiz ifşa eden mesaj yok.
- [ ] Hizmet şartı/KVKK bilgilendirmesi ile pazarlama iznini ayır; otomatik Google girişini pazarlama onayı kabul etme. Zorunlu onay metni/sürümü/zamanı gerektiği şekilde saklanır.
- [ ] Test: `register_returns_to_selected_price`, `oauth_cancel_keeps_context`, `unsafe_return_url_rejected`, `reset_token_reuse_denied`. Çıkıştan sonra özel sayfa cache/back ile hassas veri göstermez.

## W04 — İşletme oluşturma ve onboarding portalı

Bağımlılık: C02, W03. Dosyalar: mevcut `AccountPanel.tsx`; yeni `components/account/{AccountShell,TenantSelector,CreateTenantForm,OnboardingChecklist}.tsx`, `app/hesabim/isletmeler/page.tsx`.

- [ ] Yeni hesabı doğrudan boş profile bırakma. İşletme adı, ülke, para birimi, saat dilimi ve gerekli ticari bilgiler için kısa adım; gereksiz adres/telefonu satış öncesi zorunlu yapma.
- [ ] Tenant oluşturma idempotent; refresh/back/retry ikinci işletme yaratmaz. Birden fazla işletmede bağlam açık, diğer tenant'ın cihaz/abonelik cache'i temizlenir.
- [ ] Checklist: hesabı doğrula, paket seç, ödemeyi tamamla, uygulamayı indir, cihazı bağla, kurulumu tamamla. Durumlar gerçek olaylardan; müşteri kutucuğu işaretleyerek lisans kazanamaz.
- [ ] Hesap ana sayfası aktif kullanıcıya kurulum reklamı tekrarlamaz; abonelik/cihaz/son uyarı ve destek gösterir. Kullanıcı ilerlemeyi kapatıp geri dönebilir.
- [ ] Kabul: yeni hesap, paketsiz işletme, ödeme bekleyen, cihazı olmayan aktif, çalışan işletme ve iki tenant ekranları ayrı fixture ile doğrulanır.

## W05 — Checkout ve ödeme sonucu

Bağımlılık: C04/C05, W02/W04. Dosyalar: yeni `components/billing/{CheckoutSummary,CheckoutResult}.tsx`, `app/odeme/sonuc/page.tsx`, `lib/billingApi.ts` ve testleri.

- [ ] Satın alma öncesi işletme, paket sürümü, dönem, vergi, toplam, yenileme/iptal ve gerekli fatura bilgilerini göster. Kullanıcı bu özeti görmeden sağlayıcıya yönlendirme.
- [ ] Checkout oluşturulurken bir idempotency key kullan; refresh/retry aynı işleme bağlanır. Süresi dolmuş teklif yeni toplamı sessizce kabul etmez; değişikliği gösterir.
- [ ] Dönüş URL'sindeki `success=true` gibi bilgiye güvenme. Sunucu durumunu sorgula: pending ise bekleme, sipariş ID ve destek; active ise indir/kurulum; failed/canceled ise güvenli yeni deneme.
- [ ] Polling süre/beklenti sınırı ve backoff; sonsuz spinner yerine “Doğrulama sürüyor, hesabından takip edebilirsin.” Ödeme tamamlandıktan sonra geciken entitlement ayrı hazırlanıyor durumu olabilir.
- [ ] Test: `forged_success_url_does_not_activate`, `double_click_reuses_checkout`, `late_webhook_updates_result`, `cancelled_checkout_keeps_account`. Gerçek sandbox ödeme hem web hem Labs'ta aynı tutar.

## W06 — Abonelik ve ödeme yönetimi

Bağımlılık: C05, W05. Dosyalar: yeni `components/billing/{SubscriptionPanel,ChangePlanDialog,CancelSubscriptionDialog,PaymentHistory}.tsx`; yeni hesap route'ları.

- [ ] Aktif paket, cihaz/özellik hakları, dönem başlangıç/bitiş, gelecek ücret ve iptal durumu. Tarih timezone açıklamasıyla tutarlı.
- [ ] Paket değişimi preview: yeni fiyat, geçerlilik tarihi, kapanacak özellikler ve cihaz fazlası. Onaydan sonra sunucudan kesin sonuç; eski fiyat varsayımı yok.
- [ ] Dönem sonu iptal ile hesap silmeyi ayır; caydırıcı labirent veya gizli düğme yok. İptal geri alma destekleniyorsa aynı şartlarla görünür.
- [ ] Ödeme yöntemi değişimini sağlayıcının güvenli portalına bağla; kart verisi bizim formdan geçmez. “Fatura” yalnız gerçekten hukuki fatura ise; aksi halde ödeme belgesi.
- [ ] Kabul: active/past_due/cancelAtPeriodEnd/expired/refunded; para ve erişim durumu birbirini doğru açıklar. Düşük limit uyarısı çözülmeden downgrade onayı tamamlanmaz.

## W07 — İndirme, cihazlar ve ilk çalıştırma köprüsü

Bağımlılık: C06, R01; taslak download UI R01 öncesi yalnız test. Dosyalar: yeni `app/indir/page.tsx`, `app/hesabim/cihazlar/page.tsx`, `components/account/{DeviceList,DeviceApproval}.tsx`.

- [ ] İndirme sayfası yayın manifestinden sürüm/OS/URL alır; stable/beta karışmaz, doğrulanmamış platform düğmesi yok. Sistem gereksinimleri ve kısa kurulum rehberi.
- [ ] Cihaz onayında uygulama adı, işletme, cihaz etiketi, istenen erişim ve kalan slot; tanımadığı eşleme isteğini reddetme. Kod/token URL loglarına taşınmaz.
- [ ] Cihaz isimlendirme, lastSeen/sürüm, iptal; offline cihaz iptalinin gecikmesi açık. “Cihaz sil” işletme finans verisini silmez.
- [ ] Kabul: bir slot için iki paralel onaydan biri reddedilir; expired kod yeniden onaylanamaz; doğru kullanıcı yanlış tenant'a cihaz bağlayamaz.

## W08 — Destek ve bildirimler

Bağımlılık: C08, L06. Dosyalar: `components/account/SupportPanel.tsx`, `app/destek/page.tsx`; yeni `TicketDetail.tsx`, `NotificationCenter.tsx`.

- [ ] Yeni talep: kategori, konu, açıklama; işletme otomatik ama görünür. Tanılama paylaşımı açık kapsamla ve secret redaction ile; ekran görüntüsü/ek destekleniyorsa güvenli kurallar uygulanır.
- [ ] Ticket listesi, detay, yanıt, durum, son güncelleme ve okunmamış bilgisi. Submit tekrarı tek mesaj; ağ hatasında metin kaybolmaz.
- [ ] Bildirim merkezi çözüm aksiyonu taşır; ödeme/destek/cihaz bildirimi doğru tenant'a açılır. Okundu sorun çözümü değildir.
- [ ] Kabul: web mesajı Labs'a, Labs müşteri yanıtı web'e gelir; iç not gelmez; başka tenant ticket ID'si ile erişim 403/404 ve veri yok.

## W09 — Hesap, hukuki içerik ve veri hakları

Bağımlılık: C10/C11, satıcı/veri kararları. Dosyalar: mevcut hukuki route'lar ve `LegalPage.tsx`; yeni `components/account/{SecurityPanel,DeleteAccountFlow}.tsx`.

- [ ] Profil/e-posta değişimi yeniden doğrulama; bağlı giriş yöntemleri; aktif oturumlar ve iptal. Tek giriş yöntemini kaldırarak hesabı erişilemez bırakma.
- [ ] Hesap silmeden önce işletme sahipliği, abonelik, verinin saklanacağı yerler ve export; C10 iş akışı sonucu açık. Başarı ancak ilgili aşama tamamlandıysa.
- [ ] Hukuki metinleri gerçek veri akışı, ödeme sağlayıcısı, bulut, destek, cihaz, analytics ve saklama ile eşle. Taslak metni yetkili uzman kontrolüne hazırla; hukuki uygunluk garantisi verme.
- [ ] İzin gerektiren analytics/marketing consent öncesi çalışmaz; reddetmek temel giriş/checkout'u bozmaz. İletişim adresleri ve versiyon/tarih gerçek.
- [ ] Kabul: son OWNER silmesi kontrollü, session revoke geçerli, özel hesap sayfaları noindex ve özel cache; silme sonrası yanıltıcı “her veri yok” vaadi yok.

## W10 — SEO, GEO, performans ve dönüşüm kabulü

Bağımlılık: W01–W09; mobil mağaza sayfaları M06 sonrası. Dosyalar: `app/{layout,robots,sitemap}.ts*`, `components/JsonLd.tsx`, metadata ve public içerik; yeni `docs/web-acceptance.md`.

- [ ] Her public sayfaya özgün title/description/H1/canonical; crawl edilebilir linkler, doğru status code, redirect haritası, sosyal paylaşım görseli, sitemap ve robots. Hesap/ödeme/auth içeriği indexlenmez.
- [ ] SEO/GEO için somut cevaplar yaz: hangi işletmeler, hangi cihazlar, offline ne kadar/ne zaman, fiyatın kapsamı, veri sahipliği, kurulum ve destek. Kaynak/tarih ve ürün sürümünü içerik bakım sürecine bağla.
- [ ] Organization/SoftwareApplication/Breadcrumb/uygun Offer yapısal verileri yalnız görünür ve gerçek içerikle eşleşirse ekle. Uydurma rating/review yok; SSS schema zengin sonuç garantisi değildir.
- [ ] Arama/AI görünürlüğü için özel dosya veya şema sihirli çözüm sayılmaz. Server-rendered anlaşılır içerik, teknik erişilebilirlik ve gerçek ürün bilgisi temel; `llms.txt` SEO'nun yerine geçmez. [Google AI özellikleri rehberi](https://developers.google.com/search/docs/appearance/ai-features).
- [ ] Görseller responsive boyut/alt/dimensions; hero LCP kaynağı optimize, aşağıdaki görseller lazy; font subset/preload ölçülü; GSAP yalnız gerekli sayfaya. Hedef: mobil gerçek kullanıcı p75 LCP ≤2.5sn, INP ≤200ms, CLS ≤0.1; yayın öncesi laboratuvar ölçümü hedefe yakınlığı gösterir, gerçek kullanıcı verisi diye sunulmaz.
- [ ] Event sözlüğü: package_view, signup_complete, checkout_created, checkout_confirmed, download_click, device_activated, first_setup_complete. İzin ve veri minimizasyonu; ödeme dönüşü yerine sunucu teyidi conversion kaynağı.
- [ ] Kabul: robots/sitemap/status/schema kontrolü; üç mobil/desktop ölçüm, JS kapalı içerik, klavye akışı ve Q02 uçtan uca satın alma. Search Console doğrulama ve index takibi işletme hesabıyla; sıralama/AI alıntısı garantisi yok.
