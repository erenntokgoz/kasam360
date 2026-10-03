/**
 * Faz 13 · Kroki geometri sözleşmesi.
 *
 * Bu dosya backend'in `backend/src/services/floor360/types.rs` dosyasının
 * TypeScript karşılığıdır. İki taraf ayrı ayrı yazılır ve
 * `floor360Contract.test.ts` ikisini karşılaştırır. Neden ayrı: backend crate'i
 * `ts-rs` taşımıyor, tip üretimi yok. Elle tutulan tek kopya frontend'de durur.
 *
 * DÖNÜŞÜM KURALI: backend `snake_case` alan adı kullanır, IPC katmanı bunları
 * otomatik olarak `camelCase`e çevirir. Bu yüzden buradaki alan adları Rust
 * karşılıklarının birebir karşılığıdır; `current_total_cents` gibi isimler
 * bilinçli olarak korunur.
 */

export const CANVAS_WIDTH = 4000;
export const CANVAS_HEIGHT = 3000;
export const GRID = 20;
export const ROTATION_STEP = 15;

/** Sandalye sayıları. Backend `validate_seats` ile aynı kümeyi kabul eder. */
export const ALLOWED_SEATS: readonly number[] = [2, 4, 6, 8];

/** Mimari obje türleri. Backend `floor_objects.kind` CHECK kısıtıyla aynı küme. */
export const OBJECT_KINDS = ['DOOR', 'BAR', 'WALL', 'COLUMN'] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** Backend `tables.status` CHECK kısıtı: üç değer, üçten fazlası yok. */
export type TableStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED';

export interface LayoutTable {
  id: string;
  name: string;
  status: TableStatus;
  x: number;
  y: number;
  rotation: number;
  seats: number;
  zone_id: string | null;
  /** Kuruş cinsinden. Float yasak; backend `i64` gönderir. */
  current_total_cents: number;
}

export interface FloorZone {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface FloorObject {
  id: string;
  zone_id: string | null;
  kind: ObjectKind;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  is_active: boolean;
}

export interface FloorLayout {
  zones: FloorZone[];
  tables: LayoutTable[];
  objects: FloorObject[];
  canvas_width: number;
  canvas_height: number;
  grid: number;
  rotation_step: number;
}

/** Düzen kaydetme gövdesi: yalnız **taşıma**, obje yaratmaz. */
export interface SaveLayoutInput {
  tables: TablePlacement[];
  objects: ObjectPlacement[];
}

export interface TablePlacement {
  table_id: string;
  x: number;
  y: number;
  rotation: number;
  seats: number;
  zone_id: string | null;
}

export interface ObjectPlacement {
  object_id: string;
  zone_id: string | null;
  kind: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Mimari obje oluşturma gövdesi. `saveLayout` yeni obje yaratmadığı için ayrı. */
export interface CreateObjectInput {
  zone_id: string | null;
  kind: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface FloorTemplateInfo {
  id: string;
  name: string;
  description: string;
}

/** Obje türlerinin varsayılan ölçüleri. Backend `default_object_size` ile aynı. */
export const DEFAULT_OBJECT_SIZE: Record<ObjectKind, { width: number; height: number }> = {
  DOOR: { width: 80, height: 80 },
  BAR: { width: 400, height: 60 },
  WALL: { width: 400, height: 20 },
  COLUMN: { width: 40, height: 40 },
};

/** Objelerin Türkçe adı. Arayüzde İngilizce `kind` değeri gösterilmez. */
export const OBJECT_KIND_LABELS: Record<ObjectKind, string> = {
  DOOR: 'Kapı',
  BAR: 'Bar',
  WALL: 'Duvar',
  COLUMN: 'Kolon',
};

/**
 * Masa durumunun rengi ve etiketi.
 *
 * Neden ayrı sözlük: renk kararı üç ayrı bileşende (kroki, kart, filtre) tekrar
 * edilirse salon bir yerde boş görünür. Isı haritası bu renkten türer.
 */
export const TABLE_STATUS_STYLE: Record<TableStatus, { label: string; token: string }> = {
  AVAILABLE: { label: 'Boş', token: 'available' },
  RESERVED: { label: 'Rezerve', token: 'reserved' },
  OCCUPIED: { label: 'Dolu', token: 'occupied' },
};