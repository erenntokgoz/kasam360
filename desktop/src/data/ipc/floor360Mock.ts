/**
 * Faz 13 · Kroki 360° mock komut katmanı.
 *
 * Neden ayrı dosya: mock, backend ile **aynı** kapıları uygular. Gevşek kalan
 * mock, tarayıcıda çalışan uygulamayla gerçek uygulamanın farklı davranmasına
 * yol açar (fail-open). Buradaki üç kapı:
 *
 *   1. Yetki — salon herkese açık, çizim yalnız sahibe/müdüre.
 *   2. Kiracı — boş kiracı reddedilir, `DEFAULT_TENANT`e düşülmez.
 *   3. Doğrulama — tuval sınırı, ızgara, döndürme adımı, sandalye kataloğu.
 *
 * Kritik kural: bu mock **kendi durumunu tutar**. Başka bir test mock'u sıfırlamayı
 * unutursa bu testler birbirini kirletir; `resetMockFloor360` her testte çağrılır.
 */

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  GRID,
  OBJECT_KINDS,
  ROTATION_STEP,
  type CreateObjectInput,
  type FloorLayout,
  type FloorObject,
  type FloorZone,
  type FloorTemplateInfo,
  type LayoutTable,
  type ObjectKind,
  type SaveLayoutInput,
} from '../../presentation/components/floor/kroki/krokiTypes';

/** Komut adları. `tauriInvoke` dispatcher bu listeyi tanır. */
export const FLOOR360_COMMANDS = [
  'get_floor_layout',
  'save_floor_layout',
  'create_floor_zone',
  'delete_floor_zone',
  'create_floor_object',
  'delete_floor_object',
  'apply_floor_template',
  'list_floor_templates',
] as const;

export type Floor360Command = (typeof FLOOR360_COMMANDS)[number];

/** Garson masayı bulmak zorunda; salon herkese açık. */
const READ_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];
/** Garson salonu görür, yerleşimi değiştiremez. */
const WRITE_ROLES = ['OWNER', 'MANAGER'];

interface MockArgs {
  actorRole?: string;
  actor_role?: string;
  tenantId?: string | null;
  tenant_id?: string | null;
  [key: string]: unknown;
}

interface MockState {
  zones: FloorZone[];
  tables: LayoutTable[];
  objects: FloorObject[];
  /**
   * Hangi objeler şablondan geldi?
   *
   * Backend'de bu bilgi `floor_objects.template_id` kolonunda durur. Mock'ta
   * kolon DTO'ya taşınmadığı için ayrı bir küme olarak modellenir. Amaç
   * davranışın birebir aynı olması: şablon yeniden uygulandığında **yalnız**
   * bu kümedeki objeler değişir, kullanıcının elle koyduğu kapı ve bar kalır.
   *
   * Etikete bakarak silmek yanlıştır: "etiketi olanları sil" kuralı elde
   * konmuş, adı olan bir kapıyı siler ve şablon işlemi kullanıcının el emeğini
   * yok eder.
   */
  sablonObjeKimlikleri: Set<string>;
}

/**
 * Birkaç masayla başlayan örnek salon.
 *
 * Neden hazır veri: boş salon, kroki bileşeninin yerleşim mantığını sınamaz.
 * Üç masa, iki bölüm ve iki mimari obje, sürükleme/ızgara/nesne render'larının
 * hepsini tetikler.
 */
function ornekSalon(): MockState {
  return {
    zones: [
      { id: 'zon_1', name: 'Ana Salon', sort_order: 0, is_active: true },
      { id: 'zon_2', name: 'Teras', sort_order: 1, is_active: true },
    ],
    sablonObjeKimlikleri: new Set<string>(),
    tables: [
      {
        id: 'tbl_1',
        name: 'Masa 1',
        status: 'AVAILABLE',
        x: 300,
        y: 400,
        rotation: 0,
        seats: 4,
        zone_id: 'zon_1',
        current_total_cents: 0,
      },
      {
        id: 'tbl_2',
        name: 'Masa 2',
        status: 'OCCUPIED',
        x: 500,
        y: 400,
        rotation: 0,
        seats: 4,
        zone_id: 'zon_1',
        current_total_cents: 24500,
      },
      {
        id: 'tbl_3',
        name: 'Masa 3',
        status: 'RESERVED',
        x: 700,
        y: 400,
        rotation: 90,
        seats: 6,
        zone_id: 'zon_2',
        current_total_cents: 0,
      },
    ],
    objects: [
      {
        id: 'obj_1',
        zone_id: null,
        kind: 'BAR',
        label: 'Bar',
        x: 300,
        y: 180,
        width: 620,
        height: 60,
        rotation: 0,
        is_active: true,
      },
      {
        id: 'obj_2',
        zone_id: null,
        kind: 'DOOR',
        label: 'Giriş',
        x: 940,
        y: 180,
        width: 60,
        height: 60,
        rotation: 0,
        is_active: true,
      },
    ],
  };
}

let durum: MockState = ornekSalon();
let sayac = 0;

/**
 * Yeni kimlik üretir.
 *
 * Neden ayrı fonksiyon ve neden `yeni_` öneki: mock'un örnek verisi `obj_1`,
 * `obj_2` gibi kimlikler kullanır. Üretilen kimlikler aynı kalıplıysa (örneğin
 * `obj_1`) yeni obje örnek verideki bir objenin kimliğine biner ve şablon
 * uygulaması "şablondan gelenleri sil" adımında kullanıcının el emeğini de
 * siler. Bu hata yalnız ikinci uygulamada göründüğü için ilk test geçer.
 */
function yeniKimlik(onek: string): string {
  sayac += 1;
  return `${onek}_yeni_${sayac}`;
}

export function resetMockFloor360(): void {
  durum = ornekSalon();
  sayac = 0;
}

/** Testlerin okuyabilmesi için durum okuyucu. */
export function readMockFloor360State(): MockState {
  return durum;
}

export function mockFloor360CommandNames(): string[] {
  return [...FLOOR360_COMMANDS];
}

export function isMockFloor360Command(cmd: string): boolean {
  return (FLOOR360_COMMANDS as readonly string[]).includes(cmd);
}

function rol(args: MockArgs): string {
  return String(args.actorRole ?? args.actor_role ?? '');
}

function kirac(args: MockArgs): string {
  return String(args.tenantId ?? args.tenant_id ?? '').trim();
}

/** Yetki kapısı. Okuma ve yazma listeleri ayrıdır. */
function yetki(args: MockArgs, yazma: boolean): void {
  const izinli = yazma ? WRITE_ROLES : READ_ROLES;
  if (!izinli.includes(rol(args))) {
    throw new Error(`UNAUTHORIZED: ${rol(args) || 'ROL YOK'} bu işlemi yapamaz`);
  }
}

/** Kiracı kapısı. Boş kiracı reddedilir, varsayılana düşülmez. */
function kiracKontrol(args: MockArgs): string {
  const k = kirac(args);
  if (k.length === 0) {
    throw new Error('UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi');
  }
  return k;
}

/** Geometri kapısı. Backend `validate_table_placement` ile aynı kurallar. */
function masaKontrol(girdi: SaveLayoutInput['tables'][number]): void {
  if (girdi.x < 0 || girdi.x > CANVAS_WIDTH) {
    throw new Error(`VALIDATION: x sınır dışı (${girdi.x})`);
  }
  if (girdi.y < 0 || girdi.y > CANVAS_HEIGHT) {
    throw new Error(`VALIDATION: y sınır dışı (${girdi.y})`);
  }
  if (girdi.rotation < 0 || girdi.rotation >= 360) {
    throw new Error(`VALIDATION: döndürme 0-360 derece aralığında olmalı (${girdi.rotation})`);
  }
  if (girdi.rotation % ROTATION_STEP !== 0) {
    throw new Error(`VALIDATION: döndürme ${ROTATION_STEP} derece adımında olmalı (${girdi.rotation})`);
  }
  if (![2, 4, 6, 8].includes(girdi.seats)) {
    throw new Error(`VALIDATION: sandalye sayısı 2, 4, 6 veya 8 olmalı (${girdi.seats})`);
  }
}

function objeKontrol(girdi: SaveLayoutInput['objects'][number] | CreateObjectInput): void {
  if (!OBJECT_KINDS.includes(girdi.kind as ObjectKind)) {
    throw new Error(`VALIDATION: bilinmeyen obje türü (${girdi.kind})`);
  }
  if (girdi.x < 0 || girdi.x > CANVAS_WIDTH || girdi.y < 0 || girdi.y > CANVAS_HEIGHT) {
    throw new Error(`VALIDATION: obje konumu tuval dışı (${girdi.x}, ${girdi.y})`);
  }
  if (girdi.width < 20 || girdi.width > 2000 || girdi.height < 20 || girdi.height > 2000) {
    throw new Error(`VALIDATION: obje ölçüsü 20-2000 piksel aralığında olmalı`);
  }
}

const SABLONLAR: FloorTemplateInfo[] = [
  { id: 'klasik_kafe', name: 'Klasik Kafe', description: 'Sekiz masa, arka bar, tek giriş' },
  { id: 'ocakbasi', name: 'Ocakbaşı', description: 'On masa, mutfak geçidi, iki kolon' },
  { id: 'fast_food', name: 'Fast Food', description: 'On iki sıkışık masa, sipariş hattı' },
  { id: 'teras', name: 'Teras', description: 'Altı masa, bahçe çiti, bahçe barı' },
];

/**
 * Şablonun ürettiği mimari objeler.
 *
 * Neden mock'ta da var: boş bir şablon uygulaması testin anlamını düşürür.
 * "Şablon ikinci kez uygulandığında kapılar çiftlenmiyor" ancak şablon gerçekten
 * kapı üretiyorsa anlamlıdır.
 */
const SABLON_OBJELERI: {
  kind: ObjectKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}[] = [
  { kind: 'BAR', label: 'Bar', x: 300, y: 180, width: 620, height: 60 },
  { kind: 'DOOR', label: 'Giriş', x: 940, y: 180, width: 60, height: 60 },
];

/**
 * Mock komut yürütücüsü.
 *
 * Neden `Promise.reject` yerine `throw`: `tauriInvoke` senkron hatayı da yakalayıp
 * aynı hataya çevirir; testler `rejects` ve `throws` ayrımına bakmaz.
 */
export function mockFloor360Result(cmd: string, args: MockArgs): unknown {
  switch (cmd) {
    case 'get_floor_layout': {
      yetki(args, false);
      kiracKontrol(args);
      const bolum = String(args.zoneId ?? args.zone_id ?? '').trim();
      const bolumFiltresi = bolum.length > 0;
      return {
        zones: durum.zones,
        tables: bolumFiltresi
          ? durum.tables.filter((t) => t.zone_id === bolum)
          : durum.tables,
        objects: bolumFiltresi
          ? durum.objects.filter((o) => o.zone_id === bolum)
          : durum.objects,
        canvas_width: CANVAS_WIDTH,
        canvas_height: CANVAS_HEIGHT,
        grid: GRID,
        rotation_step: ROTATION_STEP,
      } satisfies FloorLayout as unknown as string;
    }

    case 'save_floor_layout': {
      yetki(args, true);
      kiracKontrol(args);
      const body = args.args as SaveLayoutInput;
      // Tüm doğrulama yazmadan önce: yarım kayıt bırakmamak, backend ile aynı.
      for (const masa of body.tables) masaKontrol(masa);
      for (const obje of body.objects) objeKontrol(obje);
      for (const masa of body.tables) {
        const hedef = durum.tables.find((t) => t.id === masa.table_id);
        if (!hedef) throw new Error(`NOT_FOUND: masa bulunamadı (${masa.table_id})`);
      }
      for (const obje of body.objects) {
        const hedef = durum.objects.find((o) => o.id === obje.object_id);
        if (!hedef) throw new Error(`NOT_FOUND: obje bulunamadı (${obje.object_id})`);
      }
      for (const yerlesim of body.tables) {
        const hedef = durum.tables.find((t) => t.id === yerlesim.table_id);
        if (hedef) {
          hedef.x = yerlesim.x;
          hedef.y = yerlesim.y;
          hedef.rotation = yerlesim.rotation;
          hedef.seats = yerlesim.seats;
          hedef.zone_id = yerlesim.zone_id;
        }
      }
      for (const yerlesim of body.objects) {
        const hedef = durum.objects.find((o) => o.id === yerlesim.object_id);
        if (hedef) {
          hedef.x = yerlesim.x;
          hedef.y = yerlesim.y;
          hedef.rotation = yerlesim.rotation;
          hedef.kind = yerlesim.kind as ObjectKind;
          hedef.label = yerlesim.label;
          hedef.width = yerlesim.width;
          hedef.height = yerlesim.height;
          hedef.zone_id = yerlesim.zone_id;
        }
      }
      return undefined as unknown as string;
    }

    case 'create_floor_zone': {
      yetki(args, true);
      kiracKontrol(args);
      const ad = String(args.name ?? '').trim();
      if (ad.length === 0) throw new Error('VALIDATION: bölüm adı boş olamaz');
      if (durum.zones.some((z) => z.name === ad)) {
        throw new Error('CONFLICT: bu isimde bir bölüm zaten var');
      }
      const id = yeniKimlik('zon');
      durum.zones.push({
        id,
        name: ad,
        sort_order: Number(args.sortOrder ?? args.sort_order ?? 0),
        is_active: true,
      });
      return id;
    }

    case 'delete_floor_zone': {
      yetki(args, true);
      kiracKontrol(args);
      const id = String(args.zoneId ?? args.zone_id ?? '');
      const sira = durum.zones.findIndex((z) => z.id === id);
      if (sira < 0) throw new Error('NOT_FOUND: bölüm bulunamadı');
      durum.zones.splice(sira, 1);
      for (const masa of durum.tables) if (masa.zone_id === id) masa.zone_id = null;
      for (const obje of durum.objects) if (obje.zone_id === id) obje.zone_id = null;
      return undefined as unknown as string;
    }

    case 'create_floor_object': {
      yetki(args, true);
      kiracKontrol(args);
      const body = args.args as CreateObjectInput;
      objeKontrol(body);
      const id = yeniKimlik('obj');
      durum.objects.push({
        id,
        zone_id: body.zone_id,
        kind: body.kind as ObjectKind,
        label: body.label,
        x: body.x,
        y: body.y,
        width: body.width,
        height: body.height,
        rotation: body.rotation,
        is_active: true,
      });
      return id;
    }

    case 'delete_floor_object': {
      yetki(args, true);
      kiracKontrol(args);
      const id = String(args.objectId ?? args.object_id ?? '');
      const sira = durum.objects.findIndex((o) => o.id === id);
      if (sira < 0) throw new Error('NOT_FOUND: obje bulunamadı');
      durum.objects.splice(sira, 1);
      return undefined as unknown as string;
    }

    case 'apply_floor_template': {
      yetki(args, true);
      kiracKontrol(args);
      const sablonId = String(args.templateId ?? args.template_id ?? '');
      const sablon = SABLONLAR.find((s) => s.id === sablonId);
      if (!sablon) throw new Error(`NOT_FOUND: bilinmeyen şablon (${sablonId})`);
      if (durum.tables.length === 0) {
        throw new Error('VALIDATION: şablon uygulanacak masa yok');
      }
      durum.tables.forEach((masa, sira) => {
        // Izgara adımı 20'nin katı olmalı; backend şablonları da öyle üretir.
        masa.x = 300 + (sira % 4) * 200;
        masa.y = 400 + Math.floor(sira / 4) * 200;
        masa.rotation = 0;
        masa.seats = 4;
      });

      // Yalnız şablonun **kendi** objeleri yenilenir. Elle konanlar korunur.
      const yeniKimlikler = new Set<string>();
      for (const obje of SABLON_OBJELERI) {
        const id = yeniKimlik('obj');
        yeniKimlikler.add(id);
        durum.objects.push({
          id,
          zone_id: null,
          kind: obje.kind,
          label: obje.label,
          x: obje.x,
          y: obje.y,
          width: obje.width,
          height: obje.height,
          rotation: 0,
          is_active: true,
        });
      }
      durum.objects = durum.objects.filter((o) => !durum.sablonObjeKimlikleri.has(o.id));
      durum.sablonObjeKimlikleri = yeniKimlikler;
      return sablon.name;
    }

    case 'list_floor_templates':
      return SABLONLAR as unknown as string;

    default:
      throw new Error(`NOT_FOUND: bilinmeyen Faz 13 komutu (${cmd})`);
  }
}