> Belge kapsamı: mevcut teknik uygulama/inceleme kaydıdır; yeni ürün kararları ve teslim sırası için [ana plan](uygulama-tamamlama-plani.md) geçerlidir. Buradaki tamamlanma ifadeleri güncel kabul testlerinin yerine geçmez.

# Bulut eşitleme sözleşmesi

İşletme verisinin asıl yeri MongoDB Atlas'taki işletme kümesidir (üyelik ve lisans anahtarı ayrı hesap kümesindedir); kasadaki SQLite hız için yerel kopyadır. Kasa önce yerele yazar, ardından işlemleri sırayla buluta gönderir. Uygulama: `backend/api/src/sync/`. Site `/api/desktop/:path*` isteklerini API'ye yönlendirdiği için uçlar `/api/desktop/sync/...` altındadır.

## Kimlik doğrulama

Her istekte iki başlık gönderilir:

- `Authorization: Bearer <lisans anahtarı>`: `/api/desktop/license-key` ile alınan `lk_...` anahtarı.
- `x-device-id`: **lisans cihaz kimliği**, yani yerel `device_license.device_id` (`^[A-Za-z0-9_-]{8,64}$`). İşlemlerdeki `deviceId` (yerel ağdaki kasa kimliği) bundan farklı olabilir.

Anahtarın sahibi hesaptır. Bir hesap tek bir işletme kiracısına bağlanır: ilk `push` isteğindeki `tenantId` hesaba bağlanır, sonra başka kiracı kabul edilmez. Bir kiracı da yalnız bir hesaba bağlı olabilir.

Cihaz lisansı, kasanın `/api/desktop/license` ile aldığı son belgeye göre değerlendirilir; sunucu 360 Labs'a her istekte sormaz.

| Uç | Lisans koşulu |
|---|---|
| `pull`, `snapshot` | Etkin, engelsiz, paketli lisans gerekir. V1 lisansı İstanbul gün sonu +72 saat uyum süresini kullanır. V2 lisansında `min(paidUntil, offlineUntil)` kesin UTC anıdır; o anda erişim sona erer. |
| `push` | Etkin cihaz normal işlemleri gönderir. Süresi dolmuş cihaz yalnız kendi kimliğiyle gönderim yapabilir; `createdAt` istemciden geldiği için bitiş öncesi kayıt kanıtı sayılmaz. Bu cihazın gönderdiği tüm işlemler doğrulanana kadar işletme sırasına alınmadan kalıcı inceleme kuyruğunda tutulur. İptal/engel ise istek gövdesi okunmadan reddedilir. |
| `release` | Etkin veya yalnız süresi dolmuş cihaz için izinlidir; iptal edilmiş/engellenmiş cihaz reddedilir. Release yalnız kuyruk bırakma kaydıdır, yeni işletme kaydı oluşturmaz. |

Güvenlik iptali ve süre sonu ayrı standing değerleridir. İptal veya engel; V1/V2, push/release dahil tüm erişimi kapatır. Bu durumda kuyruk kurtarma istisnası yoktur. Tenant V2 kaydında tam `paidUntil` ve `offlineUntil` saklanır; V1 gün toleransı V2’ye taşınmaz. Eski tenant aynası tam anlık alanlar gelene dek fail-closed kalır.

## Hata biçimi

Her hata `{ "code": "...", "message": "...", ...ayrıntı }` biçimindedir. `message` kullanıcıya gösterilebilir Türkçe metindir; istemci yalnız `code` değerine göre karar verir.

| HTTP | `code` | Anlamı |
|---|---|---|
| 400 | `INVALID_DEVICE` | `x-device-id` yok veya biçimi bozuk. |
| 400 | `INVALID_JSON` | Gövde JSON değil. |
| 401 | `INVALID_KEY` | Anahtar geçersiz, iptal edilmiş veya sahibi silinmiş. Cihaz yeniden bağlanmalı. |
| 403 | `EMAIL_NOT_VERIFIED` | Hesabın e-postası doğrulanmamış. |
| 403 | `DEVICE_NOT_LICENSED` | Bu cihaz bu hesapla hiç lisans almamış. |
| 403 | `DEVICE_REVOKED` | Cihaz erişimi iptal edilmiş; kuyruğa özel istisna yoktur. |
| 403 | `LICENSE_BLOCKED` | Lisans güvenlik/hesap kararıyla engellenmiş; tüm sync erişimi kapalıdır. |
| 403 | `LICENSE_INACTIVE` | Okuma uçları için lisans şu an geçerli değil. |
| 403 | `NEW_OPERATION_AFTER_EXPIRY` | Süresi dolmuş cihaz, başka bir yerel cihaz kimliğine ait işlemi gönderemez. |
| 202 | `SYNC_REVIEW_REQUIRED` | İşlemler kayıpsız saklandı, ancak işletme verisine/sırasına uygulanmadı; ilgili işletmenin OWNER incelemesi bekleniyor. Aynı içerik tekrar gönderilebilir. |
| 403 | `TENANT_MISMATCH` | İşlem veya satır başka kiracıya ait ya da hesap başka kiracıya bağlı. Ayrıntıda `index` bulunabilir. |
| 409 | `TENANT_TAKEN` | Kiracı başka hesaba bağlı. |
| 409 | `OPERATION_CONFLICT` | Aynı `operationId` farklı içerikle gönderildi. Ayrıntıda `operationId` bulunur. |
| 409 | `OPERATION_REJECTED`, `OPERATION_ALREADY_ACCEPTED` | İnceleme kararıyla çelişen tekrar isteği. |
| 409 | `OPERATION_PENDING_REVIEW` | Bekletilen işlem, lisansı yenilenmiş başka bir push ile inceleme kararı atlanarak uygulanamaz. |
| 409 | `CURSOR_AHEAD` | `after` veya `asOf` değeri sunucudaki son sıradan büyük. Ayrıntıda `lastSeq` bulunur; istemci tam geri yükleme yapmalı. |
| 409 | `PENDING_OPERATIONS` | Çıkış reddedildi: kasanın işlemleri bulutta eksik. |
| 413 | `PAYLOAD_TOO_LARGE`, `TOO_MANY_OPERATIONS`, `TOO_MANY_CHANGES` | Sınır aşıldı; gönderim bölünmeli. |
| 422 | `INVALID_OPERATION` | İşlem biçimi bozuk. Ayrıntıda `index` (işlemin sırası) ve `field` bulunur. |
| 422 | `DUPLICATE_OPERATION` | Aynı işlem tek gönderimde iki kez var. |
| 422 | `INVALID_QUERY`, `INVALID_RELEASE` | Sorgu veya çıkış gövdesi geçersiz. |

Bir işlemin hatası bütün gönderimi düşürür; kısmi yazım olmaz. 5xx yanıtında istemci aynı gönderimi aynen yeniden dener.

## Sınırlar

| Sınır | Değer |
|---|---|
| `push` gövdesi | 4 MiB |
| `push` başına işlem | 500 |
| `push` başına satır değişikliği (tüm işlemler toplamı) | 10 000 |
| `release` gövdesi | 4 KiB |
| `pull` `limit` | varsayılan 200, en çok 500 |
| `snapshot` `limit` | varsayılan 500, en çok 1000 |
| Anahtar metni | 1024 bayt |
| JSON iç içelik | 32 düzey |

Kayıpsız saklanamayan değerler 422 ile reddedilir: güvenli aralık dışındaki tamsayı (|n| > 2^53−1), sonsuz sayı, boş karakter (`\u0000`) ve eşsiz vekil karakter.

## İşlem biçimi

Gönderilen işlem, Rust `Operation` yapısının serde çıktısıdır (`backend/src/services/lan_sync/op_log.rs`):

```json
{
  "operationId": "op_01J...",
  "tenantId": "tnt_01J...",
  "deviceId": "dev_01J...",
  "actorId": "SYSTEM",
  "actorRole": "System",
  "intentSha256": "64 küçük onaltılık karakter",
  "op": { "domain": "CHANGES", "body": { "base_state": 12, "changes": [ ... ] } },
  "createdAt": "2026-11-05T10:00:00+00:00"
}
```

- Kimlik alanlarının biçimi `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$`, kiracı kimliğininki `^[a-z]{2,4}_[0-9A-Za-z]{1,40}$`, `actorRole` değerininki `^[A-Za-z_]{1,32}$`'dir.
- `op.domain` şu değerlerden biridir:
  - `CHANGES`: gövdesi `{ base_state: tamsayı, changes: RowChange[] }`.
  - `CARI`: gövdesi nesnedir.
  - `SET_MEMBERS`: gövdesi dizidir.
  - `NOOP`: gövdesi yoktur.

`RowChange` biçimi: `{ "table": "orders", "action": "I" | "U" | "D", "key": { kolon: değer }, "row": { kolon: değer } | null }`.

- `table` değeri `^[a-z][a-z0-9_]{0,62}$` biçiminde olmalı ve `sync_` ile başlamamalıdır. Kolon adları `^[A-Za-z_][A-Za-z0-9_]{0,62}$` biçimindedir. Değerler yalnız skalerdir.
- **`key` her eylemde zorunludur, I dahil.** I için anahtar değerleri `row` içindekilerle aynı olmalıdır.
- I ve U için `row` tam satırdır ve anahtar kolonlarını içerir. D için `row` yok sayılır.
- Satırda veya anahtarda `tenant_id` varsa işlemin kiracısıyla aynı olmalıdır.
- `approvals`, `email_queue`, `outbox` ve `whatsapp_queue` tabloları günlükte durur ama satır durumuna ve anlık görüntüye girmez.

## Uçlar

### `POST /api/desktop/sync/push`

İstek: `{ "operations": [Operation, ...] }`. Tüm işlemler aynı kiracıya ait olmalıdır.

Yanıt (200):

```json
{
  "tenantId": "tnt_a",
  "accepted": [{ "operationId": "op_1", "seq": 41, "duplicate": false }],
  "lastSeq": 41
}
```

- Gönderim tek transaction'dır. `seq` kiracı içinde boşluksuz artar ve gönderim sırasını izler.
- **Tekrar gönderim (idempotency):** Aynı `operationId` aynı içerikle yeniden gelirse aynı `seq` değeriyle `duplicate: true` döner. İçerik karşılaştırması alan sırasından bağımsızdır. Farklı içerikle gelirse `OPERATION_CONFLICT` döner.
- **Satır durumu:** Yalnız `CHANGES` işlemleri `sync_row` tablosuna uygulanır, sırayla ve son yazan kazanır. I ve U satırı ekler veya günceller, D satırı silinmiş olarak işaretler. U birincil anahtarı değiştirirse eski anahtar silinmiş sayılır.
- Gönderilecekler yalnız `APPLIED` durumundaki işlemlerdir, yerel `log_index` sırasıyla.

Süresi dolmuş cihaz push'u `202 SYNC_REVIEW_REQUIRED` döndürür. İstek gövdesi doğrulanır ve her işlem `sync_quarantine` içinde tenant/operation kimliği ve içerik özetiyle saklanır; `sync_operation`, sıra ve `sync_row` değişmez. Eşleşen tekrar yeni kuyruk kaydı üretmez; aynı kimlik farklı içerikle gelirse 409 olur. İstemci başarılı push yanıtı olmadığı için yerel kuyruğu ve imlecini korur.

İlgili işletmenin doğrulanmış OWNER'ı Hesabım'da gecikmiş kaydı inceleyip gerekçeyle karara bağlayabilir. Liste, cihaz kimliğini, işlem türü/değişiklik özeti ve tablo adlarını, cihazın bildirdiği zamanı, sunucuya geliş zamanını ve otomatik uygulanmama nedenini gösterir:

- `GET /v1/tenants/{tenantId}/sync/quarantine` — yalnız seçili tenant'ın OWNER'ına `pending` kayıtları ve inceleme özetini listeler. Başka tenant üyeliği olmayan istek 404 alır.
- `POST /v1/tenants/{tenantId}/sync/quarantine/{operationId}/resolve` — tam gövde `{ "decision": "accept" | "reject", "reason": "..." }`; gerekçe 3–300 karakterdir. Kabul, quarantine durumunu değiştirme, eklemeli `sync_quarantine_decision` kararı ve normal `sync_operation`/`sync_row` uygulamasını tek transaction'da yapar. Red aynı kararı ekler fakat işletme verisini değiştirmez. Aynı karar tekrarlandığında kabul aynı `seq` ile duplicate, red aynı sonuçla döner; ters karar 409'dur. Karar kaydı tenant/operation için tekildir; retry onu güncellemez. Kaynak cihaz sonradan revoke/blocked olduysa kabul reddedilir.

Kabul/cihaz iptali aynı tenant cihaz belgesindeki atomik `review_lock` ile sıralanır. İnceleme kilidi önce alınmışsa iptal `409 DEVICE_REVIEW_IN_PROGRESS` döndürür ve yeniden denenebilir; iptal önce yazılmışsa kabul `403 DEVICE_REVOKED` alır. Böylece iptal edilmiş cihazın kuyruğu geriye dönük uzlaştırılmaz.

Desktop `CloudSyncStatus.reviews` alanında pending ve rejected işlemleri cihaz, etki özeti ve gerekçesiyle gösterir. `202 SYNC_REVIEW_REQUIRED` yerel kayıt veya imleci ilerletmez; OWNER kararı beklenirken kuyruk korunur. Kabulden sonra sıradaki bulut eşitlemesi aynı `operationId` ile güvenle tekrar gönderir ve normal duplicate/idempotency yanıtıyla yerel imleci ilerletir. Red halinde yerel ürün/işletme verisi ile günlük kaydı silinmez; cihaz red kararını yerel `sync_cloud_review` içinde saklar, sonraki gönderimlerde o kaydı atlayıp imleci ilerletir. Red kaydı desktop inceleme panelinde görünür; aynı işlemin sonsuz tekrarına girmez.

### `GET /api/desktop/sync/pull?after=<seq>&limit=<n>`

Yanıt:

```json
{
  "tenantId": "tnt_a",
  "operations": [{ "seq": 42, "operationId": "...", "tenantId": "...", "deviceId": "...", "actorId": "...", "actorRole": "...", "intentSha256": "...", "op": {}, "createdAt": "..." }],
  "nextAfter": 42,
  "hasMore": false,
  "lastSeq": 42
}
```

- `seq > after` olan işlemler artan sırayla gelir. Bu lisans cihazının kendi gönderdiği işlemler atlanır ama `nextAfter` yine ilerler.
- İstemci bir sonraki istekte `after=nextAfter` gönderir ve `hasMore` false olana kadar devam eder.
- Sunucu, istemcinin gönderdiği `after` değerini o cihazın aldığı son sıra olarak imlece yazar.
- Hesap henüz kiracıya bağlı değilse `tenantId: null`, `operations: []`, `lastSeq: 0` döner.
- Aynı işlem yerel ağdan zaten gelmiş olabilir. **İstemci gelen işlemleri `operationId` ile ayıklar.**

### `GET /api/desktop/sync/snapshot?asOf=<seq>&cursor=<imleç>&limit=<n>`

Yanıt:

```json
{
  "tenantId": "tnt_a",
  "asOfSeq": 40,
  "rows": [{ "table": "orders", "key": { "id": "ord_1" }, "row": { "id": "ord_1", "tenant_id": "tnt_a" } }],
  "next": "opak imleç | null"
}
```

- İlk sayfa `asOf` olmadan istenir; sunucu o anki son sırayı `asOfSeq` olarak sabitler. Sonraki sayfalar `asOf=<asOfSeq>&cursor=<next>` ile istenir. `cursor` gönderilip `asOf` gönderilmezse 422 döner.
- Sayfa yalnız `asOfSeq` anına kadar son kez değişmiş ve silinmemiş satırları verir. Her sayfa tek bir anlık görüntü (`snapshot`) transaction'ında okunur. Sıralama tablo adı, sonra anahtara göredir.
- Kiracı bağlı değilse `tenantId: null`, `rows: []`, `next: null` döner. Bu durumda geri yüklenecek veri yoktur.

### `POST /api/desktop/sync/release`

İstek:

```json
{ "tenantId": "tnt_a", "originDeviceId": "dev_lan_a", "lastOperationId": "op_99", "operationCount": 120 }
```

- `originDeviceId`: işlemlerdeki `deviceId` değeri, yani bu kasanın yerel ağdaki kimliği.
- `operationCount`: yerel günlükte `deviceId` alanı bu kasa olan ve buluta gönderilmesi gereken işlemlerin sayısı. Hiç işlem yoksa `lastOperationId: null` ve `operationCount: 0` gönderilir.

Sunucudaki sayı ile son işlem tutarsa yanıt `{ "safeToWipe": true, "lastSeq": 140, "serverCount": 120 }` olur ve cihaz imleci kapanır. Tutmazsa 409 `PENDING_OPERATIONS` döner, yanıtta `safeToWipe: false` ve `serverCount` bulunur. Kiracı farklıysa 403 `TENANT_MISMATCH` döner.

## Akışlar

**Sürekli eşitleme:**

1. Yerelde `APPLIED` olan ve henüz `seq` almamış işlemler 500'lük gruplar hâlinde `push` ile gönderilir.
2. Dönen `seq` değerleri yerelde işaretlenir.
3. Zaman aşımında aynı grup aynen yeniden gönderilir.
4. `pull` isteği `after=<son alınan seq>` ile yapılır ve gelen işlemler `operationId` ile ayıklanarak uygulanır.

**Girişte geri yükleme:**

1. `snapshot` sayfaları `next` null olana kadar çekilir ve yerel veritabanına yazılır.
2. `snapshot.tenantId` yerel kiracı kimliği olarak kullanılır.
3. Ardından `pull?after=<asOfSeq>` ile kalan işlemler uygulanır. **U değişikliği bu aşamada ekle-veya-güncelle (upsert) olarak uygulanmalıdır:** anlık görüntü sabitlendikten sonra değişen satır sayfalarda yer almaz, yalnız U işlemiyle gelir.
4. Son `nextAfter` değeri kalıcı imleç olarak saklanır.

**Çıkış:**

1. Bekleyen tüm işlemler `push` ile gönderilir.
2. `release` çağrılır.
3. Yanıtta `safeToWipe: true` gelmeden yerel veri ve lisans silinmez. `PENDING_OPERATIONS` gelirse gönderim tekrarlanır.

## Parça 2 ve 3'ün bilmesi gerekenler

1. **I için `key` zorunludur.** Şu anki yakalama (`capture.rs`) eklemede `key: null` üretiyor; sunucu bunu 422 ile reddeder. Ya yakalama eklemede de anahtar kolonlarını üretmeli, ya da istemci göndermeden önce anahtarı şemadan doldurmalı.
2. **Yalnız `CHANGES` işlemleri anlık görüntüye girer.** `CARI`, `SET_MEMBERS` ve `NOOP` günlükte saklanır ama satır durumuna yansımaz. Cari kayıtları buluttan geri yüklenebilsin diye, `CARI` işleminin ürettiği satır değişiklikleri buluta `CHANGES` olarak da gönderilmelidir.
3. Tek cihazlı kurulumda yakalama tetikleyicileri yok, yani `CHANGES` üretilmiyor. Bulut eşitleme için yakalama her kurulumda açık olmalı. Mevcut yerel veri ilk bağlanmada bir kez, I değişiklikleri içeren `CHANGES` işlemleriyle yüklenmelidir.
4. `pull` isteğinde gelen işlemler `operationId` ile ayıklanır; yerel ağdan gelmiş bir işlem buluttan da gelebilir.
5. `x-device-id` lisans cihaz kimliğidir; işlemlerdeki `deviceId` ise yerel ağdaki kasa kimliğidir.
6. Sıra yalnız buluta varış sırasıdır. Yerel ağ dışından aynı satıra yazan iki kasada son gönderen kazanır.
