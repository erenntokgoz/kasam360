# Yazar kasa (YN ÖKC) entegrasyonu — GMP-3 sözleşmesi

Durum: altyapı ve simülatör testleri tamam; **gerçek yazar kasa ile hiç denenmedi.** Aşağıdaki hiçbir madde "cihazda çalışıyor" anlamına gelmez. Kod: `backend/src/services/okc/`, komutlar `backend/src/commands/okc_commands.rs`, tahsilat kapısı `backend/src/commands/payment_commands/fiscal.rs`.

## 1. Kaynaklar

| Kaynak | Bulgu |
|---|---|
| GİB, YN ÖKC-Harici Donanım ve Yazılım Haberleşme Protokolü GMP-3, **sürüm 5.0 (02.08.2018)** | ynokc.gib.gov.tr "Teknik Kılavuzlar ve Protokoller" sayfasında listelenen en güncel GMP-3 sürümü (17 Kasım 2026 itibarıyla daha yeni sürüm bulunamadı). Bu belge yalnız **eşleşme ve güvenlik katmanını**, **EFT-POS mesajlarını**, kurallı akış ilkelerini (§5, §6, Ek-1) tanımlar. |
| GİB YN ÖKC Teknik Kılavuzu (08.09.2023) ve TSM kılavuzları | Başvurulmadı; ÖKC üreticisi/TSM tarafını ilgilendirir. |
| Token Developer Portal, X Platform | Pratikte kullanılan entegrasyon **ham GMP-3 değil**, üreticinin kütüphanesidir (aşağıda §2). |

Belgeden alınan ve koda geçen kurallar: kablolu iletişim (§2.2, §2.6: Ethernet, RS232, USB-sanal seri; wi-fi, bluetooth, RF yasak), STX/ETX/ACK/NAK (3000 ms, 3 deneme), TLV uzunluk kodlaması, ISO 8859-9 metin, BCD tutar, sol dolgu (§2.9), işlem sıra numarası kuralı (§3.2.5), INIT/KEYREQ/CLOSE/ECHO mesaj tipleri ve alanları (§3.4), RFC 3526 grup 14 DH, TLS 1.2 PRF ile KHMAC/IV/KENC türetimi, anahtar kontrol verisi, finansal mesajlarda KENC şifreleme ve bankacılık grubu HMAC (§4.3), en çok 8192 bayt paket.

## 2. Önemli bulgular (mimariyi belirleyenler)

1. **Fiş akışı mesajları belgede yok.** GMP-3 sürüm 5.0'da "fiş başlat, kalem ekle, ödeme, kapat" mesajı tanımlı değildir. Belge yalnız ilkeyi verir: satış YN ÖKC'de başlar, ÖKC mali uygulaması benzersiz numara üretip harici sisteme verir, satış ÖKC'de sonlanır (§5.3.1, §6.1). Mesaj düzeni üreticiye özeldir. Bu yüzden `sale.rs` mesajları **KASAM360 taslağıdır** (bkz. §4).
2. **Eşleşme yalnız üretici kütüphanesiyle.** §3.3: PC yazılımı, ÖKC üreticisinin temin ettiği **derlenmiş GMP-3 kütüphanesini** kullanmak zorundadır; eşleşmeyi yetkili servis yapar (üretici kullanıcı düzeyinde eşleşme yazılımı sunabilir). Üreticinin test etmediği/kütüphanesini kullanmayan yazılım eşleşemez. Bu nedenle bizim eşleşme kodumuz referans/simülatör amaçlıdır; üretimde üretici kütüphanesi arkasına gidilmesi beklenir.
3. **Token modeli (örnek üretici yolu).** Token X Connect Wire: USB kablolu, `IntegrationHub.dll` (Windows, C# örnekleri), JSON **sepet** modeli (`basketID`, `items[]`, `paymentItems[]`; fiyat kuruş, miktar ×1000, `taxPercent` baz puan: 1000 = yüzde 10; ödeme türü 1 nakit, 3 kredi kartı, 7 yemek kartı), sonuç geri çağırma (callback) ile gelir, satıştan önce cihazdan "fiscal info" (kısım/KDV numaraları) çekmek zorunludur. Cloud (kablosuz sunucu) yolu ayrıdır ve GMP-3 §6 TSM yolunun karşılığıdır. Paket de sıkıştırılmış ve şifrelidir; yani ham GMP-3 TLV'si doğrudan konuşulmaz. Bizim `ReceiptDraft` (sepet kimliği, kalemler, ödemeler, kuruş) bu sepet modeliyle bire bir eşlenir; üretici adaptörü `DeviceConnector` içine yazılacaktır.
4. **Eşleşme anahtarları kalıcı saklanmıyor.** Gerçek cihazda anahtarlar güvenli alandadır; bu uygulamada yalnız bellektedir. Gerçek cihaz yolunda `SystemConnector` bu yüzden **her zaman "eşleşme yok" hatası verir** (sahte başarı yok). Simülatör dışında fiş kesilemez.

## 3. Mimari

```
tlv -> frame -> transport -> session -> pairing / sale -> gate -> payment_commands::fiscal
 kodlama  paket   seri/USB/TCP   istek-cevap  eşleşme / fiş    tahsilat kapısı
```

- `transport.rs`: `Transport` trait'i; `TcpTransport` (gerçek), `SerialTransport<P: SerialIo>` (STX/ETX/ACK/NAK; port açıcı yok), simülatör taşıması. USB, sanal seri olarak `SerialIo` üzerinden gelir. Bluetooth/Wi-Fi taşıması yoktur; ayar doğrulaması da bu tür port adlarını ve genel IP/alan adı TCP adreslerini reddeder.
- `crypto.rs`: DH (num-bigint), HMAC-SHA256 (sha2), TLS PRF, AES-256-CBC (`aes`, `cbc`). Yeni bağımlılıklar: `num-bigint`, `aes`, `cbc`.
- `pairing.rs`: INIT, KEYREQ, CLOSE. Sertifika zinciri doğrulaması `CertificateVerifier` arkasındadır; **varsayılan doğrulayıcı her eşleşmeyi reddeder** (kök sertifikalar elimizde değil). Cihazın bildirdiği DH asalı/üreteci RFC 3526 grup 14 ile aynı değilse eşleşme reddedilir; küçük alt grup değerleri reddedilir.
- `sale.rs`: `issue_receipt` = sepeti sorgula → (kapalıysa aynı fiş) → (açıksa iptal) → başlat → kalemler → ödemeler → kapat (beklenen toplam ve indirim gider). Kapanış cevabı kaybolursa sepet yeniden sorgulanır; kapalıysa başarı, değilse `OKC_OUTCOME_UNKNOWN`.
- `simulator.rs`: yalnız `debug_assertions` veya `test` ile derlenir; sürüm derlemesinde yoktur ve `SIMULATOR` ayarı kaydedilemez. Hata enjeksiyonu: kağıt yok, kart reddi, istek düşmesi, cevap kaybı, yanlış toplam.
- `gate.rs`, `receipt_draft.rs`, `receipt_log.rs`, `settings.rs`: ayar, fiş taslağı, günlük, kapı.

### Tahsilat davranışı

- Ayar `okc_settings.enabled`, **varsayılan kapalı**; kapalıyken tahsilat akışı değişmez.
- Açıkken `process_payment` ve adisyon tahsilatı (`process_split_payment`) kesinleşmeden önce fiş keser. Fiş kesilemezse işlem geri alınır: adisyon açık kalır, stok/kasa/defter yazılmaz; `okc_receipts` içine `FAILED` satırı (kalıcı uyarı) yazılır ve komut `OKC_*: ...` hatası döner. Aynı adisyonun başarılı bir sonraki tahsilatı uyarıyı `SUPERSEDED` yapar.
- `basket_id = transaction_id`: yeniden denemede cihaz aynı kimliği ikinci kez fişe çevirmez; yerelde `ISSUED` satırı varsa cihaza hiç gidilmez.
- Veresiye fişe girmez. Bilinmeyen ödeme yöntemi reddedilir. Tüm tutarlar kuruş tamsayıdır.
- Komutlar: `get_okc_settings`, `set_okc_settings` (yalnız OWNER), `test_okc_connection`, `list_okc_failures`. **Arayüz bu sürümde yazılmadı**; komutlar hazır, ekranlar yok.

## 4. Uygulanan mesajlar

| Mesaj | Tip (istek/cevap) | Durum |
|---|---|---|
| INIT, KEYREQ, CLOSE, ECHO | `FF8A60/FF8E60`, `FF8A62/..`, `FF8A63/..`, `FF8A64/..` | Belgeden alınan alanlar; simülatörle sınandı; **cihazla sınanmadı** |
| Fiş başlat | `FF8A80/FF8E80` | **KASAM360 taslağı** |
| Kalem ekle | `FF8A81` | taslak |
| Ödeme (nakit 1, kart 3, yemek kartı 7) | `FF8A82` | taslak |
| Fiş kapat | `FF8A83` | taslak |
| Açık fişi iptal | `FF8A84` | taslak |
| Sepet sorgula | `FF8A85` | taslak |

Taslak mesajlar `DF30` özel veri grubu (`DFB010..DFB017`) ve bankacılık grubundaki tutar etiketlerini (`DFEE0E` tutar, `DFEE18` indirim, `DFEE5A/5B/5C` Z/fiş/EKÜ no) kullanır. Hata kodları: belgedeki 10-13, 20, 30-32, 90; taslak 40-55 (`session.rs` içinde `describe_error`).

## 5. Doğrulanmamış varsayımlar (cihazla veya üretici belgesiyle sınanmalı)

1. LRC = mesaj tipi etiketinden son veri baytına XOR. Belge algoritmayı yazmıyor.
2. Baştaki 2 baytlık uzunluk = terminal seri no (12) + mesaj tipi TLV + LRC bayt sayısı; terminal seri no sağdan boşlukla doldurulur.
3. Finansal mesajda "mesaj tipi etiketinden LRC'ye kadar" bölüm şifrelenir; seri no ve uzunluk açıktır. Mesaj başına rastgele 16 baytlık IV şifreli verinin önüne eklenir (belge IV'yi mesaj bazında tanımlamıyor).
4. Rastsal sayı 16 bayt (alan tablosu); metin 3.4 "32 bayt" diyor, çelişki var.
5. Sabit uzunluklu ASCII alanlar (20/16) boşlukla sağdan doldurulur.
6. İşlem sıra numarası sayacı dolunca (999999) belge başa dönmeyi söyler; biz fail-closed durup yeniden eşleşme istiyoruz.
7. Taslak satış mesajlarının tamamı (tipler, etiketler, kapanışta toplam/indirim çapraz kontrolü, sepet sorgusu).
8. Parçalı tahsilatta fişe giren tutar kalem toplamından küçükse fark kalemlere **oransal** dağıtılır. Mali açıdan doğru mu (ör. ödeme türüne göre ayrı fiş, kısım bazlı dağıtım), üretici ve mali müşavirle doğrulanmalı.
9. Kalem indirimi satır tutarına işlenir, fişte ayrı indirim satırı yoktur; sıfır tutarlı (ikram) kalem fişe girmez.
10. Kalem adı 40 karaktere kesilir.

## 6. Eksikler

- Gerçek cihaz testi, üretici kütüphanesi/SDK adaptörü, PÖKC sertifika zinciri doğrulaması (kök sertifikalar, RSASSA-PKCS1-v1_5 SHA-256), anahtarların güvenli kalıcı saklanması.
- Seri/USB için işletim sistemi port açıcısı (örn. `serialport` bağımlılığı veya üretici sürücüsü); yalnız çerçeveleme ve testi var.
- Kapanmış fişin iptali, iadesi, Z raporu/gün sonu, fatura/e-Arşiv bilgi fişi, avans/cari tahsilat belge türleri, müşteri bilgisi, kısım/KDV numaralarını cihazdan çekme ("fiscal info").
- Cihazın EFT-POS/yemek kartı uygulamasına özel akış (banka seçimi, slip yazdırma, Kaydet/Fiş Yazdır mesajları §4.3.9-4.3.10). Kartlı ödeme tutarı şimdilik cihaza ödeme satırı olarak gider.
- Mobil/LAN'daki yardımcı kasalar: ayar ve günlük cihaza özgüdür, eşitlenmez.
- Arayüz: ayar ekranı, kalıcı uyarı bandı, kasiyer için "tekrar dene" akışı.
- Yazar kasa açıkken adisyon tahsilatı yazma kilidini cihaz cevabı boyunca tutar (en kötü durumda cihaz zaman aşımı kadar); sahada yük altında ölçülmedi.

## 7. Üreticiye sorulacak sorular (Beko, Hugin, Ingenico, PAYGO, Token)

1. Üçüncü taraf satış yazılımı için hangi yol destekleniyor: ham GMP-3, yerel kütüphane/SDK (hangi dil/platform: Windows DLL, Linux, Android), yerel REST/JSON, yoksa yalnız bulut? Rust'tan çağırmak için C arayüzü veya komut satırı köprüsü var mı?
2. Fiş akışı mesajlarının tam belirtimi: fiş başlat, kalem, indirim/artırım, ödeme, kapat, iptal, iade, benzersiz numara (§6.1) ve sepet sorgusu; hata kodu tablosu.
3. Aynı sepet kimliğinin (`basketID`) iki kez gönderilmesi veya bağlantı koptuktan sonra yeniden gönderilmesi cihazda nasıl ele alınıyor? Kapanış sonucunu sonradan sorgulama var mı?
4. Eşleşme: kim yapar, kullanıcı düzeyinde eşleşme var mı, anahtarlar PC tarafında nerede saklanır, uygulama yeniden başlayınca yeniden eşleşme gerekir mi, kök sertifika ve PÖKC doğrulaması kütüphanede mi?
5. Kısım (bölüm) ve KDV eşlemesi cihazda mı kurulur? Tek fişte farklı KDV, servis bedeli, ikram ve satır indirimi nasıl gönderilir? Tutara göre parçalı ödemede kalem dağıtımı kabul edilir mi?
6. Kartlı ve yemek kartlı ödeme: cihazın kendi ödeme uygulaması mı kullanılır, tutar POS'tan mı gelir, banka seçimi ve slip/fiş kullanıcı arayüzü kimde, reddedilen kart nasıl bildirilir?
7. Yazılım sürümü ve kütüphane güncellemesinde yeniden test/onay şartı nedir (§3.3, §5.4), kimin sorumluluğunda?
8. Test ortamı: simülatör, demo cihaz veya test ÖKC'si veriyorlar mı, ücreti ve süresi nedir?
9. Seri/USB sürücüsü, sanal COM port adı ve baud ayarı; Ethernet modunda ÖKC'nin sunucu olarak dinlediği port.
10. Hangi cihaz modelleri ve yazılım sürümleri destekleniyor, çoklu kasa/çoklu ÖKC kullanımı nasıl?

## 8. Onay ve devreye alma süreci (belgeye göre)

1. **Üretici seçimi ve anlaşma.** Eşleşme ancak ÖKC üreticisinin sorumluluğunda yapılır (§5.3, §5.5).
2. **Güvenlik Taahhütnamesi** (§5.5): yazılım üreticisi (biz) ÖKC üreticisiyle imzalar; marka/model/sürüm bilgisi test sırasında kaydedilir, değişikliklerde bildirim ve belge zorunludur. Taahhütname yoksa eşleşme yapılmaz.
3. **Üretici testi/sertifikasyonu**: üreticinin kütüphanesiyle entegrasyon testi; hangi sürümün sahada kullanılacağı kayda geçer.
4. **Onay sınıfı** (§5.3.1): harici sistem ÖKC'nin ayrılmaz mali bileşeni sayılırsa ÖKC üreticisi GİB'e yazılı başvurur, GİB TÜBİTAK'a iletir, kullanım izni GİB yazısıyla gelir; sayılmazsa bütüncül onay olmadan üretici sorumluluğunda eşleşir. Hangisine girdiğimiz üreticiyle netleştirilir.
5. **Kayıt**: eşleşen harici sistem bilgisi TSM üzerinden GİB BS'ye iletilir; işletme yazar kasasından rapor alınabilir.
6. **Saha eşleşmesi**: yetkili servis eşleştirmeyi yapar; işletmede ayar açılır (`okc_settings`). Gerçek cihazda ilk fiş ve hata senaryoları (kağıt yok, kablo çekme, elektrik kesintisi) elle denenir; bu doküman o testler yapılana kadar "cihazla doğrulanmadı" kalır.

## 9. Test kanıtı

Simülatöre karşı uçtan uca testler: `services/okc/protocol_tests.rs` (eşleşme, varsayılan doğrulayıcının reddi, karışık ödemeli fiş, tekrar denemede tek fiş, kart reddi, kağıt yok, cevap kaybı, istek kaybı ve belirsiz sonuç, yanlış toplam, tekrar oynatılan sıra numarası, sahte terminal), `services/okc/gate_tests.rs` (ayar, kapı, kalıcı uyarı, kiracı yalıtımı, oransal dağıtım, veresiye), birim testleri (`tlv`, `frame`, `crypto`, `transport`, `settings`, `types`, `receipt_draft`). Sonuç sayıları `docs/execution-status.md` içindedir. Hiçbiri gerçek cihaz değildir.
