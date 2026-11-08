# Veri sahipliği ve yetki sınırları — C01 taslağı

Durum: hedef sahiplik tablosu ana backend planıyla uyumludur; gözlenen bugünkü farklar uygulanmış karar değildir.

| Veri kümesi | Hedef tek yazma otoritesi | API | 360 Labs | Yerel Rust/SQLite |
|---|---|---|---|---|
| Hesap, doğrulama, Google bağlantısı, web oturumu | Hesap API / account MongoDB | Kimlik doğrular ve hesap kayıtlarını yazar | Yetkili projeksiyon/hesap araması | Web hesabı değildir; personel PIN'i tutar |
| Tenant kimliği ve web üyeliği | Hesap API | Üyelik ve tenant kapsamını doğrular | Ticari tenantId ile ilişki kurar | Aynı tenantId'yi taşır; yerel OWNER/personel ayrı kalır |
| Ürün, paket sürümü, fiyat, provider olayı, abonelik ve manuel entitlement | Labs | Yetkili okuma/projeksiyon, cihaz lisans talebi | Ticari asıl kayıt; audit ile yazar | İmzalı lisans/hakları doğrular, ticari kayıt düzenlemez |
| Cihaz tahsisi, limit ve iptal | Labs | Üyelik denetimi sonrası koordinasyon/projeksiyon | Tahsis/iptal asıl kaydı | Cihaza imzalı lisansı ve yerel durumu uygular |
| Sipariş, tahsilat, stok lotu, vardiya, cari/audit | İşletmenin kayıtlı yerel işlem otoritesi | Şifreli bulut aktarımını ve yedeği taşır; finans satırını yazmaz | Salt-okunur sağlık/özet; mali satır yazmaz | Yerel SQLite transaction'ı ve append-only audit asıl kayıt |
| Personel, Argon2id PIN PHC, yerel rol/aktiflik | İşletmenin yerel işlem otoritesi | Hangi web hesabının hangi tenant üyesi olduğunu doğrular; PHC döndürmez | Yetki verilmiş destek özeti dışında erişmez | Personel yetki ve PIN verisinin tek sahibi |
| Destek ticket ve müşteri mesajı | Labs | Hesap/tenant yetkisi doğrulayıp köprü olur | Ticket, iç not ve müşteri mesajı sahibi | Gizli yerel veri gönderilmez; izinli tanılama bağlamı |
| Tenant/cihaz sync kaydı | Kayıtlı yazıcı cihaz; bulut Mongo replika | İletilen operationId/tenant kapsamını doğrular, replika saklar | Doğrudan Mongo sorgulamaz | Yerel işlem günlüğü; offline kayıt kaybolmaz |

## Mevcut uygulamayla farklar

- API `backend/api/src/sync/store.ts` içindeki `sync_tenant` belgesi `user_id` üzerinden tek tenant'a bağlanır; hedef bir hesap→birden fazla tenant ve tenant→birden fazla OWNER üyeliğidir. Bu fark C02 migration/uyumluluk işidir; C01 dökümanı veri taşımaz.
- Mevcut API sync lisans anahtarı sahibini hesap kullanıcısına bağlar; sync operation tenant'ını gövdeden alır. Yetki sınırı current implementation'da `sync_tenant` kaydı ve tenant eşitliğiyle uygulanır; planlanan web üyeliği henüz yoktur.
- Mevcut Labs `admins`/`team_members` modeli ürün destek kapsamı ve global ekip erişimi taşır. Hedef `PLATFORM_ADMIN`, `BILLING_OPERATOR`, `SUPPORT_AGENT`, `READ_ONLY_AUDITOR` capability modelidir; mevcut tabloların bu dört role dönüştürüldüğü iddia edilmez.
- Mevcut Labs DB migration 18'dir; kaynakta 21'e kadar migration bulunur. Bu test çalıştırmasında DB açılmadı ve migration yapılmadı. Şema farkının veri kaybı/uyumluluk etkisi migration öncesi ayrıca ölçülmelidir.
- E-posta tenant eşlemesinde anahtar değildir. Ödeme webhook'u signature + environment + replay kontrolü olmadan hak veremez. Test olayı canlı entitlement oluşturamaz.
- Offline lease yalnız doğrulanmış son lease'in son tarihini korur; cache'ten yeni 72 saatlik süre türetilemez. LAN ada yazması finansal tek otorite kanıtı sayılmaz.

## Yetki kararları

1. Her tenant okuma/yazma çağrısı sunucu tarafında oturum/üyelik/rol ve kaynak tenant ilişkisini doğrular. İstemciden gelen `role`, `tenantId`, feature veya lisans iddiası tek başına grant değildir.
2. MASTER platform rolüdür; POS, kasa ve KDS komutlarına girmez. Labs platform rolleri işletme POS personelinden ayrıdır.
3. Web OWNER üyeliği ödeme/abonelik/cihaz yönetimine yetki verir; otomatik yerel OWNER PIN oturumu veya ikinci personel kaydı yaratmaz.
4. Cihaz senkronizasyonu işletme verisini replike eder; hesap kimlik verisini/personel PHC'yi genel HTTP cevabına veya loga çıkarmaz.
5. Audit defteri eklemelidir. Yeni düzeltme yeni olay/satır üretir; `UPDATE`/`DELETE` ile geçmiş değiştirilmez.
