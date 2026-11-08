> Belge kapsamı: mevcut teknik uygulama/inceleme kaydıdır; yeni ürün kararları ve teslim sırası için [ana plan](uygulama-tamamlama-plani.md) geçerlidir. Buradaki tamamlanma ifadeleri güncel kabul testlerinin yerine geçmez.

# Yerel Ağ Eşitlemesi

Durum: Ada modu, yeniden birleşme ve çakışma kuyruğu uygulandı; sanal ağ ve gerçek TCP testleriyle sınandı. İki fiziksel cihaz testi `docs/field-test.md` tamamlanmadan üretime hazır değildir.

## Hedef

Aynı ağdaki cihazlar birbirini görürken tek otoriteyle çalışır. Otorite düşerse kalanlar saniyeler içinde yenisini seçer. Cihaz tümüyle yalnız kalsa bile satış, sipariş, ödeme ve stok düşümü durmaz: cihaz ada modunda yerel yazar. Hiçbir işlem kaybolmaz, hiçbir çakışma sessizce yutulmaz.

## Çalışma kipleri

| Kip | Ne zaman | Yazma yolu |
|---|---|---|
| Tek cihaz | Küme yok ya da tek üye | Transaction yerelde onaylanır; satır değişiklikleri aynı transaction'da `sync_operations` günlüğüne `APPLIED` olarak eklenir. |
| Küme | Otorite ve çoğunluk erişilebilir | Değişiklik yakalanır, transaction geri alınır, otoriteye önerilir, çoğunluk onayından sonra her cihazda aynı sırayla uygulanır (`base_state` iyimser kilidi). |
| Ada | Otoriteye/çoğunluğa `ISLAND_AFTER_MS` boyunca ulaşılamıyor ya da bekleyen ada kaydı var | Transaction yerelde onaylanır; değişiklikler önceki görüntüleriyle `sync_island_ops` tablosuna eklenir. Denetim kaydı ana zincire değil cihazın alt zincirine (`audit_island_ledger`) yazılır. |

Kümeden ada moduna geçiş: otoriteye gönderilemeyen işlem (`NO_AUTHORITY`, `QUORUM_LOST`; ikisi de işlemin hiçbir günlüğe girmediğini garanti eder) yakalanan değişikliklerle ada işlemine çevrilir. Zaman aşımına uğrayan işlem (`PENDING_RESULT`) çevrilmez; günlükte olabilir ve iki kez yazılırdı.

## Kurallar

- Her işlem: `operation_id` (ön ekli ULID), `tenant_id`, `device_id`, yazan, satır değişiklikleri (yeni ve önceki görüntü). Ada işlemi ayrıca `island_epoch`, cihaz sırası `device_sequence`, `base_commit_index` ve `base_state` taşır.
- Aynı `operation_id` ikinci kez gelirse aynı sonuç döner; ada işlemi de sorgulanır.
- Ada kaydı olan cihaz, birleşme bitene kadar yalnız ada yolundan yazar; ada durumuna dayanan bir yazma kümeye gönderilmez.
- Ada kaydı varken onaylı küme kaydı uygulanmaz. Otorite yeniden görülünce cihaz önce ada değişikliklerini önceki görüntülerle geri alır, sonra küme kayıtlarını uygular, sonra ada işlemlerini tek bir `ISLAND_MERGE` kaydı olarak otoriteye önerir. Böylece birleştirme her cihazda aynı durumda, günlükteki aynı konumda çalışır.
- Denetim defterinde `UPDATE`/`DELETE` yoktur. Ada alt zinciri cihaz başına `GENESIS`'ten başlar, aynı SHA-256 kanonik biçimiyle mühürlenir. Birleşmede alt zincir satırları olduğu gibi taşınır ve ana zincire uç özetini taşıyan tek `sync:island_merged` kaydı eklenir.
- Para tutarları kuruş INTEGER; birleştirme hiçbir tutarı yeniden hesaplamaz, satırları olduğu gibi taşır.
- Yedekten geri sarılmış cihaz, kümenin daha önce birleştirdiği cihaz sırasını farklı kimlikle yeniden gönderirse birleşme reddedilir (`ROLLED_BACK`), cihaz `INTERVENTION` durumuna geçer.

## Birleştirme ve çakışma

Ada değişikliği satır bazında üç yönlü karşılaştırılır: önceki görüntü (ada başlangıcı), yeni görüntü (ada), güncel satır (küme).

| Durum | Sonuç |
|---|---|
| Yeni kimlikli ekleme | Doğrudan eklenir. |
| Güncel satır önceki görüntüyle aynı | Ada değişikliği uygulanır. |
| Sütunu yalnız bir taraf değiştirmiş | O tarafın değeri alınır. |
| Stok sayacı (`inventory_batches.remaining_quantity`, `inventory_items.current_stock`) iki tarafta düşmüş | Farklar toplanır. Parti eksiye düşerse açık aynı ürünün sonraki partilerinden FIFO ile düşülür; karşılanamazsa `STOCK_NEGATIVE`. |
| Aynı sütun iki tarafta değişmiş | Küme değeri kalır, ada değeri çakışma kaydında saklanır. Adisyon/kalem/ödeme tablosunda `ORDER_CONFLICT` (çift tahsilat dahil), masada `TABLE_CONFLICT`, cari bakiyede `BALANCE_CONFLICT`, diğerlerinde `ROW_CONFLICT`. |
| Satır kümede silinmiş | `DELETED_ELSEWHERE`; ada görüntüsü saklanır. |
| Ekleme var olan farklı satırla çakışıyor | `ROW_CONFLICT`; küme satırı kalır. |
| Yabancı anahtar bozuluyor | İşlemin iş satırları uygulanmaz, tamamı `REJECTED_ON_MERGE` ile saklanır; denetim satırları yine taşınır. |

Çakışma `merge_conflicts` tablosuna (kiracı kapsamlı, eşitlenir) düşer; kimlik ada işleminden türetildiği için her cihazda aynıdır. Otomatik silme yoktur: çift tahsilat iade akışıyla, stok sayımla düzeltilir; kayıt MANAGER/OWNER tarafından `resolve_sync_conflict` ile notla kapatılır ve kapanış denetime yazılır. Birleştirilen her ada işlemi `merged_island_ops` tablosunda tutulur; aynı işlem ikinci kez birleşmez.

## Bulut için günlük

`sync_operations` (`log_index` sırasıyla, `APPLIED`/`REJECTED`) bütün kiplerde işletmenin onaylı akışıdır; ada işlemleri birleşince bu akışa `ISLAND_MERGE` içinde, kendi `operation_id`'leriyle girer. Ada kaydı birleşmeden önce `sync_island_ops` içindedir. Gönderim imleci `sync_cloud_cursor` tablosundadır (cihaz ve akış başına son gönderilen konum); ağ kodu bu dilimde yoktur.

## Sınırlar

- İki cihaz ayrıldığında cihaz arızası ile ağ bölünmesi ayırt edilemez; iki taraf da yazar ve birleşmede çakışmalar kuyruğa düşer. Kullanılabilirlik tutarlılıktan önce gelir.
- Geri alma ile birleşme arasındaki birkaç saniyede ada kayıtları ekranda görünmez; bu arada yeni yazma birleşmeyi bekler.
- FIFO düzeltmesi parti kalanını düzeltir; satılan malın maliyet kayıtları yeniden hesaplanmaz, düzeltme birleşme ayrıntısında görünür.
- `take_over_device` kalıcı kayıpta üyeliği küçültmek için durur; ada modu nedeniyle günlük işletmede gerekmez. Üyelikten çıkarılan cihaz yeniden eşleştirilir.

## Test planı

- Sanal ağ (`engine_sim`): otorite düşmesi ve yeni seçim; iki cihaz bölünmesi, iki tarafta satış, birleşme ve iki cihazda aynı sonuç; aynı adisyonun iki adada tahsili (iki ödeme korunur, `ORDER_CONFLICT`); aynı birleşmenin tekrarı (idempotency); stok eksiye düşmesi ve FIFO düzeltmesi; birleşmeden sonra ana ve alt zincir doğrulaması; geri sarılmış ada günlüğünün reddi.
- Gerçek TCP (`replication_fault_tests`, `network_tests`): iki cihazdan biri kapanınca kalan cihaz ada modunda yazar, dönünce birleşir.
- Tek cihaz (`write_tx_tests`): her iş yazması günlüğe tek kayıtla girer.
