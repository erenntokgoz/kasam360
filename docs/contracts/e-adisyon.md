# e-Adisyon belge altyapısı

Durum: belge üretimi, kalıcı kuyruk, ayarlar ve Yönetim > e-Belge ekranı uygulandı ve birim testlerle doğrulandı. **Gerçek gönderim yoktur.** Sağlayıcı (özel entegratör) seçilmedi; üretimde tek çözümleme `UnconfiguredProvider`dır ve her çağrıyı "sağlayıcı yapılandırılmamış" ile reddeder. Resmî XSD ve entegratör test ortamıyla doğrulama yapılmadı.

Kaynak: GİB e-Adisyon Belgesi Teknik Kılavuzu V1.0 (Temmuz 2021). Kılavuz XSD'yi yalnız diyagram olarak verir; elemanların açıklamaları ve örnekleri esas alındı. e-Arşiv kılavuzuna (GİB'e raporlama) erişilemedi; bu tur kapsamında okunmadı.

## Veri akışı

```
Kapanmış adisyon (orders.status = PAID)
  └─ Yönetim > e-Belge > Belgesiz Adisyonlar > "Taslak Oluştur"
       create_e_document_draft
         ├─ ayar açık ve eksiksiz mi (fail-closed)
         ├─ adisyon için kuyrukta satır var mı → varsa aynısı döner (idempotent)
         ├─ kalem + ödeme verisi → belge modeli (services/e_document/source.rs)
         ├─ ETTN (UUID v4) + müteselsil belge numarası
         └─ UBL-TR XML (xml.rs) → e_document_queue (DRAFT)
  └─ "Gönderilecek Yap"  DRAFT → PENDING        (submit_e_document)
  └─ "Şimdi Gönder"      PENDING → SENT/FAILED  (dispatch_e_documents)
       provider.sign(xml) → provider.send(ettn, signedXml)
  └─ "Durum Sorgula"     SENT: provider.status(ettn) → remote_status
  └─ "Yeniden Dene"      FAILED → PENDING       (retry_e_document)
```

Durumlar (arayüz adı): `DRAFT` Taslak, `PENDING` Gönderilecek, `SENT` Gönderildi, `FAILED` Hata.

| Olay | Sonuç |
|---|---|
| Sağlayıcı yapılandırılmamış | Komut hata döner, belge PENDING kalır, deneme sayılmaz |
| Ağ yok / sağlayıcı geçici ulaşılamaz | Belge PENDING kalır, `last_error` yazılır, deneme sayılmaz, tur durur |
| Sağlayıcı kalıcı reddetti | FAILED, `attempts + 1`, `last_error` |
| Başarılı gönderim | SENT, `attempts + 1`, `provider_ref`, `sent_at` |
| Durum sorgusu `Rejected` | SENT → FAILED, `last_error` |
| e-Adisyon kapalı | Taslak, gönderilecek yapma ve gönderim reddedilir |

## İdempotens ve bütünlük

- `e_document_queue` üzerinde `(tenant_id, order_id)`, `(tenant_id, ettn)` ve `(tenant_id, document_number)` tekil indeksleridir; aynı adisyondan ikinci belge veritabanı seviyesinde de yazılamaz.
- Belge numarası = 3 karakter birim kodu + yıl (4) + müteselsil sıra (9). Sıra `e_document_sequences` tablosunda kiracı ve yıl başınadır; başarısız üretim işlemi geri alınır, numara tüketilmez. Boşluk üretmemek için taslak silinmez, yalnız yeniden kurulur (`rebuild_e_document_draft`; ETTN ve numara korunur).
- Gönderimde yalnız `PENDING` satırlar işlenir; durum geçişi `WHERE status = 'PENDING'` korumalıdır. Tek işleyici çalışır (eşzamanlı ikinci çağrı sırada bekler ve satırı artık PENDING görmez).
- Sağlayıcıdan beklenen sözleşme: `send` ETTN'i idempotency anahtarı sayar. "Sağlayıcıya gitti, yerelde SENT yazılamadı" aralığını (uygulama çökmesi) yalnız bu sözleşme kapatır; yerel taraf bunu tek başına kapatamaz.
- XML ve `xml_sha256` taslakta mühürlenir. Tutarlar tamsayı kuruştur; XML'de `12.34` biçimi tamsayı bölmesiyle üretilir, float yoktur.
- Kalem toplamı `orders.total_cents` ile tutmuyorsa belge üretilmez (tutarsız belge sağlayıcıda reddedilir ve ETTN yanar).
- Ayar yazma yalnız OWNER; kuyruk işlemleri OWNER ve MANAGER. Tüm sorgular `tenant_id` ile daraltılır. Ayar kaydı, taslak, onay, yeniden deneme, gönderim sonucu ve durum sorgusu `audit_ledger`a yazılır (`e_document:*`).

## XML eşlemesi (Kılavuz bölüm 3)

| Kılavuz | Değer / kaynak |
|---|---|
| Kök | `CreditNote` (UBL 2.1), `CreditNoteTypeCode = ADISYON` |
| UBLVersionID / CustomizationID / ProfileID | `2.1` / `TR1.2.1` / `EARSIVBELGE` |
| ID | birim kodu + yıl + sıra (16 karakter) |
| CopyIndicator | `false` |
| UUID (ETTN) | UUID v4 |
| IssueDate / IssueTime | kapanış anı, Türkiye saati (UTC+3 sabit) |
| Note | `ODEME:<YONTEM>:<tutar>` (NAKIT, KART, YEMEK_KARTI, VERESIYE, fark varsa DIGER) |
| AdditionalDocumentReference | `ADISYON_SESSION` + açılış/kapanış `ValidityPeriod` |
| Signature | düzenleyen VKN/TCKN, adres, `#Signature_<ettn>` |
| UBLExtensions | **boş** `ExtensionContent`; imza sağlayıcıda eklenir |
| AccountingSupplierParty | ayarlardaki VKN/TCKN, unvan, adres, vergi dairesi |
| AccountingCustomerParty | nihai tüketici: TCKN `11111111111` |
| SellerSupplierParty | `MASA_NO` (masa adı), `KULLANICI` (kapanışı yapan kasiyer) |
| TaxTotal | KDV oranına göre `TaxSubtotal`, `TaxTypeCode 0015` |
| LegalMonetaryTotal | matrah, KDV dahil toplam, ödenecek |
| CreditNoteLine | kalem adı, adet (`C62`), matrah, KDV, KDV hariç birim fiyat (4 ondalık) |

## Kılavuzdan bilinçli sapmalar ve belirsizlikler

- Kılavuz ödeme elemanı tanımlamaz; ödeme dağılımı `Note` ile yazıldı. Entegratör başka bir yer ister ise yalnız `xml.rs` değişir.
- `DocumentCurrencyCode` yazılmadı (kılavuzun ana eleman tablosunda yok); her tutarda `currencyID="TRY"` var.
- Kılavuzdaki `Region` ve alıcıdaki boş adres/ad alanları yazılmadı; alıcı kişi adı `-`.
- İkram (`is_comp`) kalemleri 0 tutarlı satır olarak girer; iptal edilmiş kalemler girmez. İndirim satırı (`AllowanceCharge`) yazılmaz, adisyon indirimi kalem toplamına yansımıyorsa belge üretimi tutarsızlık hatasıyla durur.
- Kılavuzun "hizmet tamamlanınca düzenlenen e-Fatura/e-Arşiv ETTN'i veya ÖKC sicil no" referansı (2. madde) yazılmaz; sonradan fatura bağlama akışı yoktur.
- Kuyruk cihaz yereldir. Birden çok LAN cihazından aynı adisyona taslak açılırsa iki ETTN oluşabilir; uygulama LAN'da tek yetkili gönderim cihazı politikası (ana plan C07) belirlenmeden bu kısıt kalır.
- Kapanış anında otomatik kuyruğa alma yoktur; taslak elle açılır (ödeme yoluna dokunulmadı).

## Logo (özel entegratör) için eksik listesi

Aşağıdakiler olmadan gerçek bir `EDocumentProvider` yazılamaz; hiçbiri uydurulmadı ve kodda iskelet bırakılmadı.

1. Bağlantı sözleşmesi: web servisi türü (SOAP/REST), uç noktalar, kimlik doğrulama, test ve canlı ortam adresleri.
2. İmza modeli: mali mühür/e-imza yerelde mi, entegratör bulutunda mı atılır; `UBLExtensions` içeriğini kim üretir; hangi XAdES profili.
3. Gönderilecek belge biçimi: imzasız XML mi, imzalı XML mi, zip/base64 sarmalayıcı var mı.
4. ETTN ve belge numarası: bizim ürettiğimiz kabul mü; aynı ETTN ikinci gönderimde ne döner; durum sorgu ucu ve durum kodları.
5. Resmî XSD ve şematron paketi, örnek geçerli e-Adisyon belgeleri.
6. Test sertifikası/mühür ve test VKN'si.
7. Hata kodu sözlüğü: hangi hatalar kalıcı red (HATA), hangileri geçici (bekler).
8. Hız, boyut ve toplu gönderim sınırları; gönderim için yasal azami gecikme.

## Logo'ya sorulacak sorular

1. e-Adisyon için başvuru, sözleşme ve test sürecinin adımları ve süresi nedir; belge başı mı kontör mü ücretlendirilir?
2. Entegrasyon REST mi SOAP mi; belge imzayı biz mi siz mi atarsınız?
3. İmzasız XML gönderip entegratörde imzalatmak mümkün mü; mali mühür sizde mi bizde mi durur?
4. Belge numarası (3 haneli birim kodu + 13 hane) serisini kim tahsis eder; boşluk ve iptal politikası nedir?
5. GİB'e raporlama (e-Arşiv raporu) sizin tarafınızdan mı yapılır; sıklığı ve içeriği nedir?
6. Alıcı bilinmeyen adisyonda `11111111111` TCKN'li nihai tüketici kabul edilir mi?
7. Ödeme yöntemi bilgisi belgede hangi elemanda taşınır (kılavuz v1.0'da yok); yemek kartı ve veresiye nasıl gösterilir?
8. İndirim, ikram ve servis ücreti satırları nasıl yazılır; kalem toplamı adisyon toplamıyla neden farklı olabilir?
9. Kapanmış adisyon iade/iptal edilirse e-Adisyon için iptal veya düzeltme belgesi akışı nedir?
10. Hizmet sonrası e-Fatura/e-Arşiv Fatura kesilirse e-Adisyon ile bağlama (`ETTN` referansı) sizde otomatik mi?
11. Aynı ETTN yeniden gönderilirse (ağ kopması sonrası) idempotent davranır mı; durum sorgusu hangi durumları döner?
12. Birden çok kasa/şube aynı VKN ile gönderim yapabilir mi; tek merkezden mi gönderilmeli?
13. Çevrimdışı çalışan işletmede belgenin en geç ne kadar sürede iletilmesi gerekir?
14. Resmî XSD, şematron ve örnek belge paketi ile test ortamı kimlik bilgilerini verir misiniz?
15. XML ve arşiv saklama (10 yıl) yükümlülüğü sizde mi bizde mi; saklama ücretli mi?
