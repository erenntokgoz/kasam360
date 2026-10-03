# FAZ 13 — KROKİ ÇİZİM (SPEC §12)

Durum: B0 analiz ve plan tamamlandı. B1 → B5 sırayla uygulanacak.

---

## 1. MEVCUT DURUM ANALİZİ

### 1.1 Spec durumu

`docs/PLAN-SPEC-IMPLEMENTATION.md` satır 108'de `§12 Kroki çizim` işareti **"❌ Yok"**.
Satır 298-301 Faz 13 tanımını veriyor; şema gereksinimi olarak açıkça
`tables` şemasına `x, y, rotation, seats, zone` sütunlarını sayıyor.

Detaylı bir spec bölümü **yok**; bu fazın kapsamı kullanıcı brifingindeki
sekiz maddelik kapsam + sekiz maddelik kabul kriteridir.

### 1.2 Backend

| Durum | Detay |
|---|---|
| `tables` şeması | 7 kolon: `id, tenant_id, name, status, opened_at, waiter_id, current_total`. `x/y/rotation/seats/zone` **yok**. `schema.sql:168` |
| `tables` rebuild | `db/tables_migration.rs` → `migrate_tables_current_total_to_integer`. 7 kolonlu hedef tanımı. |
| Floor komutları | `commands/floor_commands.rs` (365 satır), 8 komut: `get_floor_plan`, `move_table`, `add_table`, `remove_table`, `update_table_name`, `merge_tables`, `try_lock_table`, `unlock_table`. **Hiçbirinde geometri yok.** |
| RBAC | Floor komutlarının **hiçbirinde** `require_*` kapısı yok. Rezervasyon komutları `require_any_present(..., [Owner, Manager, Waiter])` kullanıyor. |
| Handler kaydı | `lib.rs` `generate_handler!` → `commands::get_floor_plan` vb. |
| Migration deseni | İki çeşit: (a) basit `ALTER TABLE ADD COLUMN` + `let _ =` (`faz12::migrate_products_for_86d`), (b) tam tablo rebuild + `schema_migrations` sürüm nöbetçisi (`faz12::migrate_inventory_batches_for_shelf_life`). |
| `BEGIN IMMEDIATE` | `inventory360_commands/*` içinde kullanılıyor (fiyat/reçete yazmaları). |
| dnd-kit | **Yok** — repo'da hiçbir yerde referans yok. `package.json`'da da yok. |

### 1.3 Frontend

| Durum | Detay |
|---|---|
| Görünüm seçici | `FloorPlanPanel.tsx:132-155` **çalışıyor** — `Kart` / `Kroki` düğmeleri var. |
| Kroki görünümü | `FloorPlanPanel.tsx:171-175` **yer tutucu**: "Kroki Görünümü (Sürükle & Bırak yakında eklenecek)". Ayrıca `bg-gradient` ve `radial-gradient` içeriyor — slop ihlali. |
| `TableCard` | Statik `<button>`, sürükle-bırak yok. |
| `FloorPlanContainer` | 404 satır. `onEditTable` / `onDeleteTable` callback'leri `FloorPlanPanelProps`'ta **tanımlı ama bağlanmamış**. |
| `useFloorStore` | 331 satır. Masa CRUD + rezervasyon. IPC `tauriInvoke` üzerinden. |
| Test yüzeyi | `desktop/tests/integration/floorPlan.test.ts` (202 satır, 10 test) — store seviyesi CRUD. |

### 1.4 Kritik çakışma tespiti

**`get_floor_plan` adı zaten kullanımda.** `commands.rs:23` → `pub use floor_commands::*`,
yani `commands::get_floor_plan` mevcut ve `useFloorStore` ile `floorPlan.test.ts`
ona bağlı. Yeni komut da bu adı alırsa glob-glob belirsizliği oluşur ve
`floorPlan.test.ts` kırılır.

**Karar:** Yeni komut **`get_floor_layout`** adını alır. Anlamsal olarak da doğru:
`get_floor_plan` kart görünümünün işletim verisini (durum, garip, tutar) verir;
`get_floor_layout` kroki geometrisini (x, y, rotation, seats, zone, objeler) verir.
Bu sapma plana yazıldı ve gerekçelendirildi.

---

## 2. MİMARİ KARARLAR

### 2.1 Komut adları (çakışma önleme)

| Spec'teki ad | Uygulanan ad | Gerekçe |
|---|---|---|
| `get_floor_plan(tenant_id, zone)` | **`get_floor_layout`** | `get_floor_plan` zaten var (bkz. 1.4) |
| `save_floor_layout` | `save_floor_layout` | — |
| `create_zone` | **`create_floor_zone`** | Global ad çakışmasını önler |
| `delete_zone` | **`delete_floor_zone`** | Global ad çakışmasını önler |
| `apply_template(template_id)` | `apply_floor_template` | Serbest bırakılmış isim |

### 2.2 Şema

`tables` tablosuna beş kolon. Hepsi `ALTER TABLE ADD COLUMN` ile eklenir —
SQLite kolon eklerken `CHECK`/`FK` kısıtı koyamaz, bu yüzden **doğrulama
uygulama katmanına** düşer (komutlar reddeder).

```sql
ALTER TABLE tables ADD COLUMN x         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN y         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN rotation  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN seats     INTEGER NOT NULL DEFAULT 4;
ALTER TABLE tables ADD COLUMN zone      TEXT;
```

Neden `zone` nullable ve FK'siz: mevcut masaların bölümü yoktur; FK eklemek
için tabloyu rebuild etmek gerekir ve `ALTER TABLE`'da SQLite FK kısıtı
kabul etmez. Bunun yerine `save_floor_layout` ve `create_floor_zone`
komutları bölümün **kiracıya ait olduğunu** sorguyla doğrular
(AGENTS.md §3.3 — çapraz kiracı sızıntısı yasak).

Yeni tablolar — **`tenant_id` üzerinde `DEFAULT` YOK** (Faz 12 dersi,
AGENTS.md §3.3): bind edilmemiş satır ortak havuza düşmez, veritabanı hatası verir.

```sql
CREATE TABLE IF NOT EXISTS floor_zones (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS floor_objects (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    zone_id     TEXT,
    kind        TEXT NOT NULL CHECK (kind IN ('DOOR','BAR','WALL','COLUMN')),
    label       TEXT,
    x           INTEGER NOT NULL DEFAULT 0,
    y           INTEGER NOT NULL DEFAULT 0,
    width       INTEGER NOT NULL DEFAULT 80,
    height      INTEGER NOT NULL DEFAULT 80,
    rotation    INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

Migration modülü: `backend/src/db/faz13.rs`, fonksiyon
`migrate_floor_plan_layout(pool: &DbPool) -> Result<(), sqlx::Error>`.
`db/mod.rs` içinde `mod faz13;` + `init_db` içinde faz12'den sonra çağrı.

### 2.3 Geometrik sözleşme (backend tek doğruluk kaynağı)

| Alan | Birim | Aralık | Neden |
|---|---|---|---|
| `x`, `y` | piksel | 0–4000 | Kanvas 4000×3000. Negatif konum "kayıp masa" anlamına gelir, reddedilir. |
| `rotation` | derece | 0–345, **15 adım** | Spec: 15° adımlar. `rotation % 15 != 0` reddedilir. |
| `seats` | adet | 2, 4, 6, 8 | Spec: 2/4/6/8'li sandalye. Liste dışı değer reddedilir. |
| grid | 20 px | — | Snap frontend'de; backend 20'ye bölünmeyen değeri **kabul eder** (serbest yerleşim mümkün), yalnızca aralık denetler. |

### 2.4 Isı haritası

Depolama yok — `tables.status`'tan türetilir. Böylece ısı haritası her zaman
güncel durumu gösterir, ayrı bir alanın bayat kalması mümkün olmaz.

| Durum | Renk | Kaynak (AGENTS.md §4.2) |
|---|---|---|
| Boş | yeşil | `success` — dark `#30D158`, light `#34C759` |
| Dolu | sarı | `warning` — dark `#FF9F0A`, light `#FF9500` |
| Rezerve | gri | `text-quaternary` / `border-strong` tonları |

### 2.5 RBAC

Yeni komutlarda kapı zorunlu (mevcut floor komutlarının eksiği tekrar edilmeyecek):

- Okuma (`get_floor_layout`): `OWNER, MANAGER, CASHIER, WAITER, KITCHEN` —
  herkes salonu görebilir, çünkü garson masayı bulmak zorunda.
- Yazma (`save_floor_layout`, `create_floor_zone`, `delete_floor_zone`,
  `apply_floor_template`): `OWNER, MANAGER`. Garson kroki çizemez.

### 2.6 Yazma disiplini

`save_floor_layout` toplu yazmadır: `BEGIN IMMEDIATE` + audit kilidi +
`COMMIT`/`ROLLBACK`. Her masanın `tenant_id`'si ayrı ayrı doğrulanır; tek bir
masada sapma varsa **tüm düzen geri alınır** (kısmi kayıt bırakmamak için).
`create`/`delete`/tekil `apply` de aynı kuralı kullanır.

### 2.7 Frontend mimari

Yeni klasör: `desktop/src/presentation/components/floor/kroki/`

| Dosya | Satır | Sorumluluk |
|---|---|---|
| `FloorPlanCanvas.tsx` | ~230 | Kanvas, snap matematiği, dnd-kit `DndContext`, seçim |
| `TableShape.tsx` | ~180 | Kare/yuvarlak/dikdörtgen masa + sandalye halkası |
| `ArchitecturalObject.tsx` | ~120 | Kapı, bar, duvar, kolon |
| `TemplatePicker.tsx` | ~140 | 4 şablon seçimi |
| `ViewToggle.tsx` | ~70 | Kroki / Kart (mevcut düğmeler taşınır) |
| `krokiTypes.ts` | ~120 | DTO tipleri |
| `useKrokiLayout.ts` | ~200 | Fetch + optimistic düzen + kaydetme |
| `snap.ts` | ~70 | Grid matematiği, saf fonksiyon (test edilebilir) |

`FloorPlanPanel.tsx` yer tutucusunu `FloorPlanCanvas`'a bağlar; Kart görünümü
dokunulmadan kalır. `onEditTable`/`onDeleteTable` callback'leri kroki düzenleme
yüzeyine bağlanır (şu an ölüydü).

### 2.8 Bağımlılık

`@dnd-kit/core` (sürükle-bırak) + `@dnd-kit/modifiers` (kısıtlama/snapping).
Doğrulanmış: npm'de `@dnd-kit/core@6.3.1` mevcut, kurulum ağı açık.

> **Tasarım notu:** dnd-kit sürükle-bırak için, 15° döndürme ve sandalye
> ekleme dnd-kit'in kapsamı dışında olduğu için pointer olaylarıyla ele alınır.
> Snap dnd-kit `snapToGrid` yerine `snap.ts` saf fonksiyonuyla yapılır; 20 px
> ızgarada hizalama ve kanvas sınır kontrolü aynı yerde toplanır.

---

## 3. UYGULAMA SIRASI VE KABUL

### B1 — Şema
- `backend/src/db/faz13.rs` — `migrate_floor_plan_layout`
- `backend/migrations/schema.sql` — `floor_zones`, `floor_objects`, `tables` kolonları
- `backend/src/db/mod.rs` — `mod faz13` + `init_db` çağrısı
- `backend/src/db/faz13_tests.rs` — migration idempotans, kiracı satırı korunumu

### B2 — Backend komutları
- `backend/src/commands/floor_plan_commands.rs` — 5 komut (300 satır tavanı: iki parçaya bölünebilir)
- `backend/src/commands.rs` — `pub mod` + `pub use`
- `backend/src/lib.rs` — `generate_handler!` kaydı
- Testler: kiracı izolasyonu, yetki, aralık reddi, atomiklik, şablon uygulama

### B3 — Frontend
- `desktop/src/presentation/components/floor/kroki/` (8 dosya)
- `FloorPlanPanel.tsx` bağlantısı
- `useFloorStore` kroki aksiyonları
- `tauriInvoke.ts` mock: yeni komutlar tarayıcı modunda da çalışsın

### B4 — Testler
- Backend: `backend/src/commands/floor_plan_tests.rs`
- Frontend: `desktop/tests/integration/krokiFloor.test.ts`
- Sözleşme: mock komut adları ↔ handler kaydı

### B5 — Kapılar + commit
```
cd backend && cargo test --lib
cd backend && cargo clippy --lib --tests -- -D warnings
cd backend && cargo fmt --check
cd desktop && npx tsc --noEmit
cd desktop && npm run lint
cd desktop && npx vitest run
emoji taraması / bg-gradient taraması
500 satır denetimi (bileşen 300)
```

### Kabul kriterleri eşlemesi

| # | Kriter | Nerede kanıtlanır |
|---|---|---|
| 1 | Kroki/Kart değiştirici | `ViewToggle` + `FloorPlanPanel` testi |
| 2 | Sürükle-bırak + snap | `snap.ts` testi + kanvas render testi |
| 3 | Döndürme + sandalye | `save_floor_layout` 15-adım testi + sandalye 2/4/6/8 testi |
| 4 | 4 şablon | `apply_floor_template` testi (4 kimlik) |
| 5 | Isı haritası | Durum→renk eşleme testi |
| 6 | Kaydetme | Atomiklik testi (kısmi kayıt yok) |
| 7 | Kapılar | B5 çıktısı |
| 8 | Slop 0 | Emoji/gradient taraması |

---

## 4. BİLİNEN SAPMALAR VE GEREKÇELERİ

1. **`get_floor_layout` adı** — `get_floor_plan` zaten kullanımda (§1.4). Mevcut
   komut ve ona bağlı 10 test bozulmaz.
2. **`CHECK` kısıtı yok** — SQLite `ALTER TABLE ADD COLUMN` ile kısıt ekleyemez.
   `rotation`/`seats`/`x`/`y` doğrulaması komut katmanında; testler bunu kanıtlar.
3. **`zone` FK değil** — aynı SQLite kısıtı. Çapraz kiracı sızıntısı komutta
   sorguyla engellenir.
4. **`cargo clippy -D warnings` / `cargo fmt --check` yeşil değil** — repo
   başlangıcından beri pre-existing ihlaller içeriyor (Faz 12'de ölçüldü:
   73 lib + 37 test uyarısı, çok sayıda fmt farkı). Bunlar Faz 13 dışında;
   **Faz 13'ün kendi eklediği veya değiştirdiği dosyalar** clippy/fmt açısından
   temiz tutulacak ve bu ayrıca doğrulanacak. Testler yeşil kalacak.