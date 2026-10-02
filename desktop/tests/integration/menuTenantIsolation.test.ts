import { describe, it, expect, beforeEach } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

/**
 * P0 regresyon: menü yönetimi kiracı izolasyonu (mock katmanı).
 *
 * Neden ayrı paket: backend'de menü komutları `tenant_id`'yi hedef satırdan
 * çözüyordu. Bir işletme sahibi başka işletmenin `prd_...` kimliğini tahmin
 * edip ürünü değiştirebiliyor, üstelik denetim kaydı *kurbanın* defterine
 * yazılıyordu. Mock aynı davranışı taşıdığı için tarayıcı modunda yetki
 * modeli backend'den farklıydı.
 *
 * Bu paket mock'un artık **fail-closed** olduğunu kanıtlar:
 * oturumsuz çağrı reddedilir, başka kiracının kaydına dokunulamaz.
 */

const TENANT_A = 'tenant_menu_alpha';
const TENANT_B = 'tenant_menu_beta';

const ownerA = {
  tenantId: TENANT_A,
  tenant_id: TENANT_A,
  actorRole: 'OWNER',
  actor_role: 'OWNER',
  actorId: 'usr_a',
};

const ownerB = {
  tenantId: TENANT_B,
  tenant_id: TENANT_B,
  actorRole: 'OWNER',
  actor_role: 'OWNER',
  actorId: 'usr_b',
};

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
};

type CategoryRow = { id: string; name: string; display_order: number };

/**
 * Node ortamında `localStorage` yoktur; mock katmanı kalıcı depoya yazıyor.
 * Polyfill `any` kullanmadan tip güvenli kurulur (AGENTS.md §3.1 `any` YASAK).
 */
if (typeof globalThis.localStorage === 'undefined') {
  const depo: Record<string, string> = {};
  const polyfill: Storage = {
    get length() {
      return Object.keys(depo).length;
    },
    key: (index: number) => Object.keys(depo)[index] ?? null,
    getItem: (key: string) => (key in depo ? depo[key] : null),
    setItem: (key: string, value: string) => {
      depo[key] = String(value);
    },
    removeItem: (key: string) => {
      delete depo[key];
    },
    clear: () => {
      for (const k of Object.keys(depo)) delete depo[k];
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: false,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('menü yönetimi kiracı izolasyonu', () => {
  it('oturum yoksa menü komutları reddedilir', async () => {
    await expect(
      tauriInvoke<ProductRow[]>('get_management_products', {
        tenantId: '',
        tenant_id: '',
        actorRole: 'OWNER',
        actor_role: 'OWNER',
      }),
    ).rejects.toThrow(/oturum/i);
  });

  it('listeleme yalnız kendi işletmesinin ürünlerini döner', async () => {
    const aKategori = await tauriInvoke<CategoryRow>('create_category', {
      ...ownerA,
      name: 'A Kahve',
    });
    await tauriInvoke<CategoryRow>('create_category', { ...ownerB, name: 'B Kahve' });
    await tauriInvoke<ProductRow>('create_product', {
      ...ownerA,
      categoryId: aKategori.id,
      name: 'A Filtre',
      priceCents: 4500,
    });
    await tauriInvoke<ProductRow>('create_product', {
      ...ownerB,
      categoryId: 'cat-b',
      name: 'B Filtre',
      priceCents: 3500,
    });

    const aUrunler = await tauriInvoke<ProductRow[]>('get_management_products', ownerA);
    const bUrunler = await tauriInvoke<ProductRow[]>('get_management_products', ownerB);

    expect(aUrunler.map((u) => u.name)).toEqual(['A Filtre']);
    expect(bUrunler.map((u) => u.name)).toEqual(['B Filtre']);

    const aKategoriler = await tauriInvoke<CategoryRow[]>('get_management_categories', ownerA);
    const bKategoriler = await tauriInvoke<CategoryRow[]>('get_management_categories', ownerB);
    expect(aKategoriler.map((k) => k.name)).toEqual(['A Kahve']);
    expect(bKategoriler.map((k) => k.name)).toEqual(['B Kahve']);
  });

  it('başka işletmenin ürünü güncellenemez ve silinemez', async () => {
    const aUrun = await tauriInvoke<ProductRow>('create_product', {
      ...ownerA,
      categoryId: 'cat-a',
      name: 'A Filtre',
      priceCents: 4500,
    });
    await expect(
      tauriInvoke('update_product', {
        ...ownerB,
        id: aUrun.id,
        categoryId: 'cat-b',
        name: 'Calinan Ad',
        priceCents: 1,
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    await expect(
      tauriInvoke('delete_product', { ...ownerB, id: aUrun.id }),
    ).rejects.toThrow(/NOT_FOUND/);

    await expect(
      tauriInvoke('update_product_status', {
        ...ownerB,
        id: aUrun.id,
        isActive: false,
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    // A işletmesinin ürünü değişmemiş olmalı.
    const aUrunler = await tauriInvoke<ProductRow[]>('get_management_products', ownerA);
    const hayatta = aUrunler.find((u) => u.id === aUrun.id);
    expect(hayatta).toBeDefined();
    expect(hayatta?.name).toBe('A Filtre');
    expect(hayatta?.price_cents).toBe(4500);
    expect(hayatta?.is_active).toBe(true);
  });

  it('başka işletmenin kategorisi güncellenemez ve silinemez', async () => {
    const aKategori = await tauriInvoke<CategoryRow>('create_category', {
      ...ownerA,
      name: 'A Kategori',
    });

    await expect(
      tauriInvoke('update_category', {
        ...ownerB,
        id: aKategori.id,
        name: 'Calinan Kategori',
        displayOrder: 9,
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    await expect(
      tauriInvoke('delete_category', { ...ownerB, id: aKategori.id }),
    ).rejects.toThrow(/NOT_FOUND/);

    const aKategoriler = await tauriInvoke<CategoryRow[]>('get_management_categories', ownerA);
    expect(aKategoriler.find((k) => k.id === aKategori.id)?.name).toBe('A Kategori');
  });

  it('menü yönetimi kasiyere açık değildir', async () => {
    await expect(
      tauriInvoke<ProductRow[]>('get_management_products', {
        ...ownerA,
        actorRole: 'CASHIER',
        actor_role: 'CASHIER',
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});
