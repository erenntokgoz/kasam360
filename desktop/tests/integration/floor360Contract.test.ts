import { describe, it, expect, beforeEach } from 'vitest';
import {
  tauriInvoke,
  FLOOR360_COMMAND_NAMES,
} from '../../src/data/ipc/tauriInvoke';
import {
  readMockFloor360State,
  resetMockFloor360,
} from '../../src/data/ipc/floor360Mock';
import {
  ALLOWED_SEATS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_OBJECT_SIZE,
  GRID,
  OBJECT_KINDS,
  ROTATION_STEP,
  type FloorLayout,
  type FloorTemplateInfo,
  type ObjectKind,
  type SaveLayoutInput,
} from '../../src/presentation/components/floor/kroki/krokiTypes';
import {
  clampToCanvas,
  isAllowedObjectKind,
  isAllowedSeats,
  normalizeAngle,
  olcekOlustur,
  rotateByStep,
  snapPoint,
  snapRotation,
  snapToGrid,
  validateLayoutDraft,
} from '../../src/presentation/components/floor/kroki/snap';

/**
 * Faz 13 · Kroki çizim sözleşme ve geometri testleri.
 *
 * Kapsam dışı bırakılırsa dört sessiz hata geri gelir:
 *   1. Mock gevşek kalır: tarayıcıda geçersiz konum kaydedilir, hata ancak
 *      gerçek uygulamada görünür (fail-open).
 *   2. Sabit sapması: frontend ızgarası 20, backend 25 olursa sürüklemede
 *      hizalı görünen masa kaydedildiğinde kayar.
 *   3. Yetki kaçağı: garson krokiyi değiştirirse akşam servisi dağılır.
 *   4. Sessiz sıfır: bilinmeyen bir komut boş dizi dönmesin, hata versin.
 */

const TENANT = 'tenant-test';
const SAHIP = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'OWNER',
  actor_role: 'OWNER',
};
const MUDUR = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'MANAGER',
  actor_role: 'MANAGER',
};
const GARSON = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'WAITER',
  actor_role: 'WAITER',
};
const KASIR = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'CASHIER',
  actor_role: 'CASHIER',
};
const MUTFAK = {
  tenantId: TENANT,
  tenant_id: TENANT,
  actorRole: 'KITCHEN',
  actor_role: 'KITCHEN',
};

beforeEach(() => {
  resetMockFloor360();
});

describe('Faz 13 komut listesi', () => {
  it('sekiz komut tanımlı', () => {
    expect(FLOOR360_COMMAND_NAMES).toHaveLength(8);
  });

  it('komut adları benzersizdir', () => {
    expect(new Set(FLOOR360_COMMAND_NAMES).size).toBe(FLOOR360_COMMAND_NAMES.length);
  });

  it('okuma ve yazma komutları ayrı adlarla tanımlıdır', () => {
    // `get_floor_plan` mevcut komutla çakışır; yeni komut `get_floor_layout`
    // adını taşımalı, aksi halde mock'ta çalışan kod üretimde
    // "command not found" verir.
    expect(FLOOR360_COMMAND_NAMES).toContain('get_floor_layout');
    expect(FLOOR360_COMMAND_NAMES).not.toContain('get_floor_plan');
  });
});

describe('Okuma kapısı: salon herkese açık', () => {
  for (const [ad, rol] of [
    ['sahip', SAHIP],
    ['müdür', MUDUR],
    ['kasiyer', KASIR],
    ['garson', GARSON],
    ['mutfak', MUTFAK],
  ] as const) {
    it(`${ad} salonu okuyabilir`, async () => {
      const duzen = await tauriInvoke<FloorLayout>('get_floor_layout', {
        ...rol,
        zoneId: null,
      });
      expect(duzen.tables.length).toBeGreaterThan(0);
    });
  }

  it('MASTER salonu okuyamaz', async () => {
    await expect(
      tauriInvoke('get_floor_layout', {
        tenantId: TENANT,
        tenant_id: TENANT,
        actorRole: 'MASTER',
        actor_role: 'MASTER',
        zoneId: null,
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe('Yazma kapısı: çizim yalnız sahip ve müdüre', () => {
  it('sahip krokiyi kaydedebilir', async () => {
    const govde: SaveLayoutInput = {
      tables: [
        {
          table_id: 'tbl_1',
          x: 400,
          y: 400,
          rotation: 0,
          seats: 4,
          zone_id: null,
        },
      ],
      objects: [],
    };
    await expect(
      tauriInvoke('save_floor_layout', { ...SAHIP, args: govde }),
    ).resolves.toBeUndefined();
  });

  it('müdür krokiyi kaydedebilir', async () => {
    const govde: SaveLayoutInput = {
      tables: [
        {
          table_id: 'tbl_1',
          x: 420,
          y: 400,
          rotation: 0,
          seats: 4,
          zone_id: null,
        },
      ],
      objects: [],
    };
    await expect(
      tauriInvoke('save_floor_layout', { ...MUDUR, args: govde }),
    ).resolves.toBeUndefined();
  });

  for (const [ad, rol] of [
    ['garson', GARSON],
    ['kasiyer', KASIR],
    ['mutfak', MUTFAK],
  ] as const) {
    it(`${ad} krokiyi değiştiremez`, async () => {
      await expect(
        tauriInvoke('save_floor_layout', {
          ...rol,
          args: {
            tables: [
              {
                table_id: 'tbl_1',
                x: 400,
                y: 400,
                rotation: 0,
                seats: 4,
                zone_id: null,
              },
            ],
            objects: [],
          },
        }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    });
  }

  it('reddedilen yazma krokide iz bırakmaz', async () => {
    const onceki = readMockFloor360State().tables.find((t) => t.id === 'tbl_1')?.x;
    await tauriInvoke('save_floor_layout', {
      ...GARSON,
      args: {
        tables: [
          { table_id: 'tbl_1', x: 999, y: 999, rotation: 0, seats: 4, zone_id: null },
        ],
        objects: [],
      },
    }).catch(() => undefined);
    const sonraki = readMockFloor360State().tables.find((t) => t.id === 'tbl_1')?.x;
    expect(sonraki).toBe(onceki);
  });
});

describe('Kiracı kapısı', () => {
  it('boş kiracı reddedilir, varsayılana düşülmez', async () => {
    await expect(
      tauriInvoke('get_floor_layout', {
        tenantId: '',
        tenant_id: '',
        actorRole: 'OWNER',
        actor_role: 'OWNER',
        zoneId: null,
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('kiracı bilgisi hiç gönderilmezse de reddedilir', async () => {
    await expect(
      tauriInvoke('get_floor_layout', { actorRole: 'OWNER', actor_role: 'OWNER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe('Geometri kapısı: mock backend ile aynı kuralları uygular', () => {
  const taban = {
    ...SAHIP,
    args: {
      tables: [
        { table_id: 'tbl_1', x: 400, y: 400, rotation: 0, seats: 4, zone_id: null },
      ],
      objects: [],
    } satisfies SaveLayoutInput,
  };

  it('tuval dışı x reddedilir', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...taban,
        args: {
          ...taban.args,
          tables: [
            {
              table_id: 'tbl_1',
              x: CANVAS_WIDTH + 20,
              y: 400,
              rotation: 0,
              seats: 4,
              zone_id: null,
            },
          ],
        },
      }),
    ).rejects.toThrow(/x sınır dışı/);
  });

  it('tuval dışı y reddedilir', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...taban,
        args: {
          ...taban.args,
          tables: [
            {
              table_id: 'tbl_1',
              x: 400,
              y: CANVAS_HEIGHT + 20,
              rotation: 0,
              seats: 4,
              zone_id: null,
            },
          ],
        },
      }),
    ).rejects.toThrow(/y sınır dışı/);
  });

  it('negatif konum reddedilir', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...taban,
        args: {
          ...taban.args,
          tables: [
            {
              table_id: 'tbl_1',
              x: -20,
              y: 400,
              rotation: 0,
              seats: 4,
              zone_id: null,
            },
          ],
        },
      }),
    ).rejects.toThrow(/x sınır dışı/);
  });

  it('15 derece adımı dışı döndürme reddedilir', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...taban,
        args: {
          ...taban.args,
          tables: [
            { table_id: 'tbl_1', x: 400, y: 400, rotation: 7, seats: 4, zone_id: null },
          ],
        },
      }),
    ).rejects.toThrow(/döndürme/);
  });

  it('katalog dışı sandalye reddedilir', async () => {
    for (const adet of [0, 1, 3, 5, 7, 12, -4]) {
      await expect(
        tauriInvoke('save_floor_layout', {
          ...taban,
          args: {
            ...taban.args,
            tables: [
              { table_id: 'tbl_1', x: 400, y: 400, rotation: 0, seats: adet, zone_id: null },
            ],
          },
        }),
      ).rejects.toThrow(/sandalye/);
    }
  });

  it('katalogdaki dört sandalye sayısı kabul edilir', async () => {
    for (const adet of ALLOWED_SEATS) {
      await expect(
        tauriInvoke('save_floor_layout', {
          ...taban,
          args: {
            ...taban.args,
            tables: [
              { table_id: 'tbl_1', x: 400, y: 400, rotation: 0, seats: adet, zone_id: null },
            ],
          },
        }),
      ).resolves.toBeUndefined();
    }
  });

  it('olmayan masa sessizce yok sayılmaz', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...taban,
        args: {
          tables: [
            { table_id: 'tbl_olmayan', x: 400, y: 400, rotation: 0, seats: 4, zone_id: null },
          ],
          objects: [],
        },
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('geçersiz ikinci kayıt ilkini kaydettirmez', async () => {
    // Atomiklik: mock backend ile aynı davranış. Yarım kayıt bırakılırsa
    // kullanıcı salonun yarısının taşındığını görür.
    const onceki = readMockFloor360State().tables.find((t) => t.id === 'tbl_1')?.x;
    await tauriInvoke('save_floor_layout', {
      ...SAHIP,
      args: {
        tables: [
          { table_id: 'tbl_1', x: 600, y: 400, rotation: 0, seats: 4, zone_id: null },
          { table_id: 'tbl_2', x: 800, y: 400, rotation: 7, seats: 4, zone_id: null },
        ],
        objects: [],
      },
    }).catch(() => undefined);
    expect(readMockFloor360State().tables.find((t) => t.id === 'tbl_1')?.x).toBe(onceki);
  });
});

describe('Bölüm kapısı', () => {
  it('aynı adlı ikinci bölüm açılamaz', async () => {
    await expect(tauriInvoke('create_floor_zone', { ...SAHIP, name: 'Ana Salon' })).rejects.toThrow(
      /CONFLICT/,
    );
  });

  it('boş adlı bölüm açılamaz', async () => {
    await expect(tauriInvoke('create_floor_zone', { ...SAHIP, name: '   ' })).rejects.toThrow(
      /VALIDATION/,
    );
  });

  it('bölüm silinince masalar silinmez, yalnız bağlantı düşer', async () => {
    const id = await tauriInvoke<string>('create_floor_zone', {
      ...SAHIP,
      name: 'Bahçe',
    });
    await tauriInvoke('save_floor_layout', {
      ...SAHIP,
      args: {
        tables: [
          { table_id: 'tbl_1', x: 400, y: 400, rotation: 0, seats: 4, zone_id: id },
        ],
        objects: [],
      },
    });
    await tauriInvoke('delete_floor_zone', { ...SAHIP, zoneId: id });

    const durum = readMockFloor360State();
    expect(durum.tables.find((t) => t.id === 'tbl_1')).toBeDefined();
    expect(durum.tables.find((t) => t.id === 'tbl_1')?.zone_id).toBeNull();
  });
});

describe('Mimari obje kapısı', () => {
  it('dört obje türü kabul edilir', async () => {
    for (const tur of OBJECT_KINDS) {
      const olcu = DEFAULT_OBJECT_SIZE[tur];
      await expect(
        tauriInvoke('create_floor_object', {
          ...SAHIP,
          args: {
            zone_id: null,
            kind: tur,
            label: null,
            x: 1000,
            y: 1000,
            width: olcu.width,
            height: olcu.height,
            rotation: 0,
          },
        }),
      ).resolves.toEqual(expect.any(String));
    }
  });

  it('katalog dışı obje türü reddedilir', async () => {
    await expect(
      tauriInvoke('create_floor_object', {
        ...SAHIP,
        args: {
          zone_id: null,
          kind: 'HAVUZ',
          label: null,
          x: 1000,
          y: 1000,
          width: 80,
          height: 80,
          rotation: 0,
        },
      }),
    ).rejects.toThrow(/bilinmeyen obje türü/);
  });

  it('görünmez ölçülü obje reddedilir', async () => {
    for (const [genislik, yukseklik] of [
      [19, 80],
      [80, 19],
      [2001, 80],
    ]) {
      await expect(
        tauriInvoke('create_floor_object', {
          ...SAHIP,
          args: {
            zone_id: null,
            kind: 'DOOR',
            label: null,
            x: 1000,
            y: 1000,
            width: genislik,
            height: yukseklik,
            rotation: 0,
          },
        }),
      ).rejects.toThrow(/obje ölçüsü/);
    }
  });

  it('olmayan obje sessizce yok sayılmaz', async () => {
    await expect(
      tauriInvoke('save_floor_layout', {
        ...SAHIP,
        args: {
          tables: [],
          objects: [
            {
              object_id: 'obj_yok',
              zone_id: null,
              kind: 'DOOR',
              label: null,
              x: 100,
              y: 100,
              width: 80,
              height: 80,
              rotation: 0,
            },
          ],
        },
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('Şablon kapısı', () => {
  it('dört hazır şablon listelenir', async () => {
    const sablonlar = await tauriInvoke<FloorTemplateInfo[]>('list_floor_templates', {});
    const kimlikler = sablonlar.map((s) => s.id);
    expect(kimlikler).toEqual(
      expect.arrayContaining(['klasik_kafe', 'ocakbasi', 'fast_food', 'teras']),
    );
  });

  it('bilinmeyen şablon NOT_FOUND döner', async () => {
    await expect(
      tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'uzay_kahvesi' }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it('şablon masaları ızgaraya oturan konumlara taşır', async () => {
    await tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'klasik_kafe' });
    for (const masa of readMockFloor360State().tables) {
      expect(masa.x % GRID).toBe(0);
      expect(masa.y % GRID).toBe(0);
      expect(masa.rotation % ROTATION_STEP).toBe(0);
    }
  });

  it('şablon kullanıcının elle koyduğu objeyi silmez', async () => {
    const id = await tauriInvoke<string>('create_floor_object', {
      ...SAHIP,
      args: {
        zone_id: null,
        kind: 'DOOR',
        label: 'Kritik Çıkış',
        x: 3000,
        y: 2000,
        width: 80,
        height: 80,
        rotation: 0,
      },
    });
    await tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'klasik_kafe' });
    const durum = readMockFloor360State();
    expect(durum.objects.some((o) => o.id === id)).toBe(true);
  });
});

describe('Sözleşme sabitleri backend ile aynı', () => {
  it('ızgara ve döndürme adımı 20 ve 15', () => {
    expect(GRID).toBe(20);
    expect(ROTATION_STEP).toBe(15);
  });

  it('tuval 4000x3000', () => {
    expect(CANVAS_WIDTH).toBe(4000);
    expect(CANVAS_HEIGHT).toBe(3000);
  });

  it('okunan düzen sabitleri sözleşmeyle uyuşur', async () => {
    const duzen = await tauriInvoke<FloorLayout>('get_floor_layout', { ...SAHIP, zoneId: null });
    expect(duzen.canvas_width).toBe(CANVAS_WIDTH);
    expect(duzen.canvas_height).toBe(CANVAS_HEIGHT);
    expect(duzen.grid).toBe(GRID);
    expect(duzen.rotation_step).toBe(ROTATION_STEP);
  });
});

describe('Izgara ve döndürme matematiği', () => {
  it('değer ızgaraya yuvarlanır', () => {
    expect(snapToGrid(37, 20)).toBe(40);
    expect(snapToGrid(30, 20)).toBe(40);
    expect(snapToGrid(29, 20)).toBe(20);
    expect(snapToGrid(0, 20)).toBe(0);
  });

  it('konum tuvale sınırlanır', () => {
    expect(clampToCanvas(-10, 4000)).toBe(0);
    expect(clampToCanvas(5000, 4000)).toBe(4000);
    expect(clampToCanvas(1200, 4000)).toBe(1200);
  });

  it('nokta hem ızgaraya oturur hem tuvellе sınırlanır', () => {
    expect(snapPoint(37, 63, 20, { width: 4000, height: 3000 })).toEqual({ x: 40, y: 60 });
    expect(snapPoint(-30, 5000, 20, { width: 4000, height: 3000 })).toEqual({
      x: 0,
      y: 3000,
    });
  });

  it('açı 0-360 aralığına indirgenir', () => {
    expect(normalizeAngle(-15)).toBe(345);
    expect(normalizeAngle(375)).toBe(15);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(0)).toBe(0);
  });

  it('açı döndürme adımına oturur', () => {
    expect(snapRotation(7, 15)).toBe(0);
    expect(snapRotation(8, 15)).toBe(15);
    expect(snapRotation(360, 15)).toBe(0);
    expect(snapRotation(345, 15)).toBe(345);
  });

  it('döndürme düğmesi adım ilerletir', () => {
    expect(rotateByStep(0, 15, 1)).toBe(15);
    expect(rotateByStep(0, 15, -1)).toBe(345);
    expect(rotateByStep(345, 15, 1)).toBe(0);
  });

  it('katalog sorguları backend ile aynı sonucu verir', () => {
    for (const adet of [2, 4, 6, 8]) expect(isAllowedSeats(adet)).toBe(true);
    for (const adet of [0, 1, 3, 5, 7, 12, -4]) expect(isAllowedSeats(adet)).toBe(false);
    for (const tur of OBJECT_KINDS) expect(isAllowedObjectKind(tur)).toBe(true);
    expect(isAllowedObjectKind('HAVUZ')).toBe(false);
  });
});

describe('Ekran ölçeği çevirisi', () => {
  it('mantıksal tuvel ekrana sığdırılır', () => {
    // 1280 px geniş ekranda 4000 px tuvel ~3.125 kat küçülür.
    expect(olcekOlustur(1280, 4000)).toBeCloseTo(3.125);
  });

  it('ölçeklenmiş ekran delta sıfır olmaz', () => {
    // Yanlış çeviri (ölçeği ters uygulamak) 100 px sürüklemeyi 0'a indirir ve
    // "masa kaymıyor" gibi görünür. Bu test sessiz hatayı yakalar.
    const olcek = olcekOlustur(1000, 4000);
    const ekranDelta = 100;
    expect(ekranDelta * olcek).toBe(400);
    expect(ekranDelta * olcek).not.toBe(0);
  });

  it('ölçü sıfır veya negatifse 1 döner (bölme hatası yerine güvenli varsayılan)', () => {
    expect(olcekOlustur(0, 4000)).toBe(1);
    expect(olcekOlustur(-5, 4000)).toBe(1);
    expect(olcekOlustur(1000, 0)).toBe(1);
  });
});

describe('Kaydetmeden önce arayüz doğrulaması', () => {
  const kurallar = {
    grid: 20,
    rotationStep: 15,
    canvasWidth: 4000,
    canvasHeight: 3000,
  };

  it('geçerli taslak sessizce geçer', () => {
    expect(
      validateLayoutDraft({ tables: [{ x: 400, y: 400, rotation: 90, seats: 4 }] }, kurallar),
    ).toBeNull();
  });

  it('sınır dışı konum yakalanır', () => {
    expect(
      validateLayoutDraft({ tables: [{ x: 4100, y: 400, rotation: 0, seats: 4 }] }, kurallar),
    ).toMatch(/x sınır dışı/);
  });

  it('adım dışı döndürme yakalanır', () => {
    expect(
      validateLayoutDraft({ tables: [{ x: 400, y: 400, rotation: 7, seats: 4 }] }, kurallar),
    ).toMatch(/döndürme/);
  });

  it('katalog dışı sandalye yakalanır', () => {
    expect(
      validateLayoutDraft({ tables: [{ x: 400, y: 400, rotation: 0, seats: 5 }] }, kurallar),
    ).toMatch(/sandalye/i);
  });
});

describe('Şablon objeleri çiftlenmez ve el emeği korunur', () => {
  it('aynı şablon iki kez uygulandığında kapı sayısı değişmez', async () => {
    await tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'klasik_kafe' });
    const ilk = readMockFloor360State().objects.filter((o) => o.kind === 'DOOR').length;
    await tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'klasik_kafe' });
    const ikinci = readMockFloor360State().objects.filter((o) => o.kind === 'DOOR').length;
    expect(ikinci).toBe(ilk);
    expect(ilk).toBeGreaterThan(0);
  });

  it('şablon nesnesi ekler', async () => {
    const onceki = readMockFloor360State().objects.length;
    await tauriInvoke('apply_floor_template', { ...SAHIP, templateId: 'klasik_kafe' });
    expect(readMockFloor360State().objects.length).toBeGreaterThan(onceki);
  });
});

describe('Varsayılan obje ölçüleri backend ile aynı', () => {
  it('her tür için ölçü tanımlı', () => {
    const beklenen: Record<ObjectKind, { width: number; height: number }> = {
      DOOR: { width: 80, height: 80 },
      BAR: { width: 400, height: 60 },
      WALL: { width: 400, height: 20 },
      COLUMN: { width: 40, height: 40 },
    };
    expect(DEFAULT_OBJECT_SIZE).toEqual(beklenen);
  });
});