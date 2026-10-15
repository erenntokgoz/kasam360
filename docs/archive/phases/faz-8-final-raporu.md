# FAZ 8 — MASA / REZERVASYON DÜZELTMESİ (Spec §11)

**Durum:** Tamamlandı
**Tarih:** 2026-10-02
**Kapsam:** `docs/PLAN-SPEC-IMPLEMENTATION.md:244-253`

---

## 1. Sorun (mevcut davranış neden yanlıştı)

Rezervasyon bir kayıt değil, `tables.status` üzerindeki tek bir bayraktı
(`'RESERVED'`). Bu model dört ayrı yanlışa yol açıyordu:

| # | Yanlış | Kanıt (Faz 8 öncesi) |
|---|---|---|
| 1 | **Dolu masa rezerve edilebiliyordu.** `reserve_table` durum ön-koşulu taşımıyordu; `UPDATE ... status='RESERVED' WHERE id=?` açık adisyonu sessizce kaybediyordu. | `commands.rs:767-804` (eski) |
| 2 | **"Rezervasyonu Kaldır" çalışmıyordu.** Buton `onAction('Rezerve Et')` gönderiyordu; backend aynı UPDATE'i tekrar çalıştırıp `RESERVED` üzerine `RESERVED` yazıyor, kullanıcıya "Masa Rezerve Edildi" toast'u gösteriliyordu. | `TableActionModal.tsx:290-308` (eski) |
| 3 | **Müşteri bilgisi hiçbir yerde tutulmuyordu.** Ad, telefon, kişi sayısı, randevu saati için hiçbir kolon yoktu; salon planındaki mor blok "Rezerve" yazan boş bir etikete dönüşüyordu. | `schema.sql:160-168` (eski) |
| 4 | **Hareketsizlik uyarısı rezerve masada hiç çalışmıyordu.** `TableTimer` yalnız `tables.opened_at` okuyordu; rezervasyonda bekleme başlangıcı tutulmadığı için sayaç hiç render edilmiyordu. | `TableTimer.tsx:7-20` (eski) |

Ek olarak komut katmanında üç ayrı güvenlik açığı vardı ve bunlar bu fazda
kapatıldı: `move_table`/`merge_tables` tenant filtresiz yazıyordu,
`update_table_status` ise **ne tenant ne rol ne de değer doğrulaması**
taşıyordu (serbest metin status, `WHERE id = ?`).

---

## 2. Karar kuralları

1. **Rezervasyon bir kayıttır, bayrak değildir.** Yeni `reservations` tablosu; mor
   salon bloğu bu satırın varlığından türetilir.
2. **Yalnız boş masa.** Rezervasyon `AVAILABLE` olmayan masaya yazılamaz.
3. **Tek açık rezervasyon.** Kısmi tekil indeks
   `UNIQUE(tenant_id, table_id) WHERE status IN ('ACTIVE','ARRIVED')` kuralı
   veritabanı seviyesinde zorlar; iki garson aynı anda tıklasa bile ikinci
   yazma reddedilir.
4. **Kapanan kayıt silinmez.** `CANCELLED` / `NO_SHOW` / `SEATED` terminalleri
   tarihçe olarak kalır; "gelmeyen misafir" kaydı kaybolmaz.
5. **"Geldi" ile "adisyon açıldı" ayrı gerçeklerdir.** Müşteri gelince masa
   `RESERVED` kalır; adisyon ancak `submit_order` ile açılır ve kayıt `SEATED`
   olur.
6. **Kiracı izolasyonu ve RBAC fail-closed.** Rezervasyonu yalnız
   `WAITER / MANAGER / OWNER` yönetir; `tenant_id` oturumdan gelir.
7. **Uydurma yok.** Rezervasyon kaydı okunamıyorsa arayüz "Rezerve" uydurmaz,
   "Rezervasyon kaydı bulunamadı" yazar.

---

## 3. Uygulama

### 3.1 Şema — `backend/migrations/schema.sql:160-226`

- `tables.status` artık `CHECK (status IN ('AVAILABLE','RESERVED','OCCUPIED'))`.
- Yeni `reservations` tablosu: `tenant_id` zorunlu, durum makinesi CHECK'li,
  `customer_name` zorunlu, `party_size > 0`, `reserved_at`/`created_at` ayrı
  (randevu saati ileriye dönük olabilir, bekleme sayacı `created_at`'ten işler).
- 3 indeks + 1 **kısmi tekil indeks** (eşzamanlılık güvenliği).
- `db.rs` idempotent şema uygulaması sayesinde mevcut veritabanlarına da eklenir.

### 3.2 Servis — `backend/src/services/reservation_service.rs` (490 satır)

`create` · `cancel` · `mark_arrived` · `seat_for_order` · `close_open_for_table` ·
`open_for_table` · `find` · `list_open` · `list_day` · `assert_no_open_reservation`

Hata sözlüğü sabittir: `VALIDATION` (alan), `CONFLICT` (durum/tekil indeks),
`NOT_FOUND` (kiracı sınırı dışı), `UNAUTHORIZED` (tenant/rol),
`DB_ERROR` (beklenmeyen).

### 3.3 Komutlar — `backend/src/reservation_commands.rs` (yeni modül, `lib.rs`'e kayıtlı)

| Komut | Rol | Davranış |
|---|---|---|
| `get_reservations` | WAITER/MANAGER/OWNER | Salon planındaki açık kayıtlar |
| `get_reservation_day` | aynı | Günlük (kapalı kayıtlar dâhil) |
| `reserve_table` | aynı | Boş masa → `ACTIVE` + `RESERVED` |
| `cancel_reservation` | aynı | `CANCELLED`, masa boşalır |
| `mark_reservation_no_show` | aynı | `NO_SHOW` (vazgeçmeden ayrı operasyonel gerçek) |
| `mark_reservation_arrived` | aynı | `ARRIVED`, masa `RESERVED` kalır |

Her mutasyon `audit_ledger`'a **aynı transaction içinde** yazılır:
`table:reserved`, `table:reservation_cancelled`, `table:reservation_no_show`,
`table:reservation_arrived` (katalog etiketleri eklendi).

### 3.4 Rezervasyonla çakışan yollar sertleştirildi

| Yol | Değişiklik |
|---|---|
| `submit_order` | Açık rezervasyonu `SEATED` ile kapatır, masayı işgal eder |
| `process_payment` (tam + parçalı) | Masa boşalırken açık rezervasyon kapanır; **tenant filtresi eklendi** (filtresizdi) |
| `close_order_if_applicable` | `IN_PROGRESS` siparişleri de kapsar; `RESERVED` koşulu kaldırıldı (dolu masa tahsilat sonrası boşalmıyordu) |
| `void_order` | İptalde açık rezervasyon kapanır |
| `move_table` / `merge_tables` | Tenant zorunlu, tüm yazmalar tenant'lı, açık rezervasyonlu masa reddedilir |
| `update_table_status` | Rol + tenant + değer doğrulaması; `RESERVED` elle yazılamaz; boşaltma rezervasyonu kapatır |
| Kasa "Açık Hesaplar" | Rezerve masa listeden çıkarıldı (sipariş yoksa hesap da yok) |

### 3.5 Arayüz

| Dosya | Değişiklik |
|---|---|
| `useFloorStore.ts` | `reservations` durumu, `reserveTable(id, input)`, `cancelReservation`, `markReservationNoShow`, `markReservationArrived`, `fetchReservations`, `reservationForTable` |
| `ReserveTableModal.tsx` (yeni) | Müşteri adı* / telefon / kişi sayısı / randevu saati* / not; boş alan backend'den önce uyarılır |
| `TableCard.tsx` | Boş masada hızlı rezerve ikonu (kart butonunun **kardeşi**, geçersiz iç içe buton üretilmez); rezerve kart müşteri adı + kişi + bekleme sayacı; kayıt yoksa eksiklik yazısı |
| `TableTimer.tsx` | `mode="waiting"` ile rezervasyonda da çalışır; süre ilk render'da senkron hesaplanır (35 dk uyarısı ilk boyamada kaçmıyor) |
| `TableActionModal.tsx` | **Dolu masada rezervasyon butonu tamamen kaldırıldı**; rezerve masada Müşteri Geldi / Rezervasyonu Kaldır / Müşteri Gelmedi; "Geldi" işaretlenmeden Sipariş Ekle görünmez; birleştirme hedeflerinden rezerve masalar çıkarıldı ve rozet artık yanlış "Boş" yazmıyor |
| `FloorPlanContainer.tsx` | Rezervasyon eşlemesi, 5 sn'lik polling'e rezervasyon okuması, hızlı rezerve akışı, bilinmeyen masa durumu artık "rezerve" sayılmıyor |
| `auditCatalog.ts` | 3 yeni denetim etiketi |

### 3.6 Tarayıcı mock'u backend ile birebir hizalandı

`reserve_table` artık rol/tenant/ön-koşul/tekil kayıt kapılarından geçer ve
`ReservationDto` döndürür. `get_reservations`, `cancel_reservation`,
`mark_reservation_no_show`, `mark_reservation_arrived` eklendi.
`update_table_status` ve `move_table`/`merge_tables` sertleştirildi.
`try_lock_table`/`unlock_table` **ilk kez** gerçekten uygulandı (önceden genel
"{success:true}" dönüşüne düşüyordu, yani tarayıcı modunda eşzamanlılık kilidi
işlevsizdi; 30 dk TTL'li masa kilidi).

---

## 4. Kapılar (kanıt)

```
cd backend && cargo check --all-targets   → Finished (0 hata, 0 uyarı)
cd backend && cargo test                  → 206 passed; 0 failed   (Faz 7: 193 → +13)
cd desktop && npx tsc --noEmit            → 0 hata
cd desktop && npx vitest run              → 34 dosya, 386 passed  (Faz 7: 372 → +14)
npx playwright test reservation-flow.spec.ts → 4 passed
```

### 4.1 Ekran görüntüleri (gerçek Chromium)

| Dosya | Kanıt |
|---|---|
| `docs/evidence/faz8-floor-reserved-card.png` | Rezerve kart: müşteri adı, kişi sayısı, 42 dk bekleme sayacı (35 dk eşiği aşıldığı için sarı pulse) |
| `docs/evidence/faz8-reserve-modal.png` | Hızlı rezervasyon penceresi (müşteri adı, telefon, kişi, randevu saati) |
| `docs/evidence/faz8-floor-after-reserve.png` | Yazılan rezervasyonun salon planındaki karşılığı |
| `docs/evidence/faz8-occupied-no-reserve.png` | Dolu masa modalında **hiç** rezervasyon butonu yok |
| `docs/evidence/faz8-reserved-actions.png` | Rezerve masada üç gerçek aksiyon, "Sipariş Ekle" yok |
| `docs/evidence/faz8-arrived.png` | "Müşteri Geldi" sonrası GELDİ rozeti + "Adisyon bekliyor" |

### 4.2 Test kapsamı

**Backend (13 yeni test, `reservation_service_tests.rs`):** boş masa rezervasyonu,
dolu masa reddi, çapraz kiracı, ikinci açık kayıt reddi, iptal + kayıt kalıcılığı,
`NO_SHOW`, "geldi" masayı işgal etmez, `SEATED` + masa `OCCUPIED`, rezervasyonsuz
masada kayıt uydurmama, ödeme yolunda kapanma, taşıma kapısı, alan doğrulama,
salon listesi.

**Frontend (14 yeni test, `reservationFlow.test.ts`):** rezervasyon yazma, dolu masa
reddi, kaldırma, "geldi" masayı işgal etmez, "gelmedi", yetki reddi, tenant'sız
okuma reddi, çift kapatma reddi, alan doğrulama, kart içeriği, kayıtsız kart
dürüstlüğü, 35 dk uyarısı, hızlı ikonun yalnız boş masada bulunması.

**Güncellenen mevcut testler:** `floorPlan.test.ts` (rezervasyon kaydı beklentisi),
`floorPlanGlassmorphism.test.ts` (dolu masada `Rezerve Et` **bulunmamalı** +
rezerve masa için yeni test), `zeroGapFeatureMatrix.test.ts` (W2 artık rezervasyon
kapılarını gerçek komutlarla doğrular).

---

## 5. Bilinen kalan işler

1. **Rezervasyon günlüğü ekranı yok.** `get_reservation_day` hazır, ancak
   "bugün 14 rezervasyon, 3 gelmedi" ekranı Faz 9 (Hesap Defteri derinleştirme)
   kapsamında yapılmalı.
2. **Gecikmiş rezervasyon (`EXPIRED`) otomatik üretilmiyor.** Durum şemada CHECK'li
   ve hazır, ancak "randevu saati 30 dk geçti" tetikleyicisi yazılmadı; şu an
   garson "Müşteri Gelmedi" ile kapatıyor. Otomatik üretim Faz 9'da.
3. **Emoji/gradient envanteri** (Hesap Defteri, KDS, Platform ekranlarında)
   bu fazın konusu değildi; `desktop/src/presentation/components/endofday/*`
   dosyalarında 10 emoji, `kds/KdsContainer.tsx` içinde 1 gradient duruyor.
   Faz 9 (Hesap Defteri) ve Faz 15 kapsamında temizlenecek.
4. **Kasa ekranında rezerve masanın adisyonu** yalnız "Müşteri Geldi → POS"
   yolundan açılabiliyor. Kasa tarafına doğrudan "rezerve masayı tahsilata al"
   kısayolu eklenmedi (rezervasyon ihlali riski nedeniyle bilinçli olarak yok).
