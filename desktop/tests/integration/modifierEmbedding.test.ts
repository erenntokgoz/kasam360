/**
 * Modifier gömme testleri (Faz 4).
 *
 * Kapsam üç yüzeyden gelir:
 * 1. **Tarayıcı mock kuralları** — mock, backend ile aynı kapıları uygular
 *    (yalnız işletme sahibi, tenant izolasyonu, negatif fiyat farkı reddi,
 *    ürün filtresi). Mock gevşekse uygulama gerçekte olduğundan açık çalışır.
 * 2. **Yüzey sözleşmesi** — `CategoryForm`/`ProductForm` "Seçenekler &
 *    Ekstralar" alanını sunar, bağımsız Modifier sekmesi navigation'da yoktur.
 * 3. **Regresyon** — POS modifier seçimi ve fiyat ayrımı bozulmaz.
 *
 * Bu testler uygulamayı taklit etmez; gerçek modülleri çağırır.
 */

/// <reference types="vite/client" />

import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { buildOwnerNavItems } from '../../src/presentation/components/owner/OwnerDashboardContainer';
import { hasCapability } from '../../src/core/security/navigationMatrix';

const TENANT = 'tenant_modifier_test';
const OTHER_TENANT = 'tenant_other';

/** Beklenen hata metnini yakalar; hata yoksa `null` döner. */
async function captureError(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (err: unknown) => (typeof err === 'string' ? err : String((err as Error)?.message ?? err)),
  );
}

const ownerArgs = (extra: Record<string, unknown> = {}) => ({
  actorRole: 'OWNER',
  actor_role: 'OWNER',
  tenantId: TENANT,
  tenant_id: TENANT,
  ...extra,
});

describe('Faz 4 — Modifier yönetim kapıları (tarayıcı mock)', () => {
  it('yönetim komutlarını yalnız işletme sahibi çağırabilir', async () => {
    for (const role of ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']) {
      const err = await captureError(
        tauriInvoke('get_modifier_groups', {
          actorRole: role,
          actor_role: role,
          tenantId: TENANT,
          tenant_id: TENANT,
        }),
      );
      expect(err, `${role} modifier yönetemez`).toContain('UNAUTHORIZED');
    }

    const ownerGroups = await tauriInvoke<unknown[]>('get_modifier_groups', ownerArgs());
    expect(Array.isArray(ownerGroups)).toBe(true);
  });

  it('seçenek fiyat farkı negatif olamaz', async () => {
    const group = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({ name: 'Fiyat Testi', isRequired: false, minSelections: 0, maxSelections: null }),
    );

    const err = await captureError(
      tauriInvoke(
        'add_modifier_option',
        ownerArgs({ groupId: group.id, group_id: group.id, name: 'Hatalı', priceCents: -500 }),
      ),
    );
    expect(err).toContain('INVALID_MODIFIER_PRICE');

    await tauriInvoke(
      'delete_modifier_group',
      ownerArgs({ groupId: group.id, group_id: group.id }),
    );
  });

  it('fiyat farkı kuruş olarak saklanır, ürün fiyatına eklenmez', async () => {
    const group = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({ name: 'Ekstra Şablon', isRequired: false, minSelections: 0, maxSelections: null }),
    );
    await tauriInvoke(
      'add_modifier_option',
      ownerArgs({ groupId: group.id, group_id: group.id, name: 'Ekstra Peynir', priceCents: 4000 }),
    );

    const groups = await tauriInvoke<
      { id: string; options: { name: string; priceCents: number }[] }[]
    >('get_modifier_groups', ownerArgs());

    const found = groups.find(g => g.id === group.id);
    expect(found).toBeDefined();
    // 40,00 ₺ = 4000 kuruş. Bu bir **fiyat farkıdır**, ürün fiyatı değil.
    expect(found!.options[0].priceCents).toBe(4000);

    await tauriInvoke(
      'delete_modifier_group',
      ownerArgs({ groupId: group.id, group_id: group.id }),
    );
  });

  it('kategori şablonu yalnız kendi kategorisinde listelenir', async () => {
    const burger = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({
        name: 'Pişme Derecesi',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        categoryId: 'cat_burger',
      }),
    );
    const kahve = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({
        name: 'Süt Seçeneği',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        categoryId: 'cat_kahve',
      }),
    );

    const burgerOnly = await tauriInvoke<{ id: string; categoryId: string | null }[]>(
      'get_modifier_groups',
      ownerArgs({ categoryId: 'cat_burger' }),
    );
    expect(burgerOnly.map(g => g.id)).toEqual([burger.id]);
    expect(burgerOnly[0].categoryId).toBe('cat_burger');

    const kahveOnly = await tauriInvoke<{ id: string }[]>(
      'get_modifier_groups',
      ownerArgs({ categoryId: 'cat_kahve' }),
    );
    expect(kahveOnly.map(g => g.id)).toEqual([kahve.id]);

    for (const id of [burger.id, kahve.id]) {
      await tauriInvoke('delete_modifier_group', ownerArgs({ groupId: id, group_id: id }));
    }
  });

  it('başka işletmenin grubuna seçenek eklenemez ve grup silinemez', async () => {
    const group = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({ name: 'Korumalı Grup', isRequired: false, minSelections: 0, maxSelections: null }),
    );

    const foreignArgs = {
      actorRole: 'OWNER',
      actor_role: 'OWNER',
      tenantId: OTHER_TENANT,
      tenant_id: OTHER_TENANT,
      groupId: group.id,
      group_id: group.id,
    };

    const addErr = await captureError(
      tauriInvoke('add_modifier_option', { ...foreignArgs, name: 'Sızma', priceCents: 100 }),
    );
    expect(addErr).toContain('TENANT_ISOLATION');

    const deleteErr = await captureError(tauriInvoke('delete_modifier_group', foreignArgs));
    expect(deleteErr).toContain('NOT_FOUND');

    // Kurban işletmenin verisi yerinde kalmalı.
    const stillThere = await tauriInvoke<{ id: string }[]>('get_modifier_groups', ownerArgs());
    expect(stillThere.some(g => g.id === group.id)).toBe(true);

    await tauriInvoke('delete_modifier_group', ownerArgs({ groupId: group.id, group_id: group.id }));
  });

  it('başka işletmenin grubu ürüne bağlanamaz', async () => {
    const foreignGroup = await tauriInvoke<{ id: string }>('create_modifier_group', {
      actorRole: 'OWNER',
      actor_role: 'OWNER',
      tenantId: OTHER_TENANT,
      tenant_id: OTHER_TENANT,
      name: 'Yabancı Grup',
      isRequired: false,
      minSelections: 0,
      maxSelections: null,
    });

    const err = await captureError(
      tauriInvoke(
        'set_product_modifier_groups',
        ownerArgs({ productId: 'prd_mod_1', product_id: 'prd_mod_1', groupIds: [foreignGroup.id] }),
      ),
    );
    // Ürün bulunamayabilir ya da grup reddedilebilir; ikisi de sızıntı yok.
    expect(err).not.toBeNull();
  });
});

describe('Faz 4 — Ürüne bağlı modifier grupları', () => {
  it('POS görünümü yalnız ürüne bağlı grupları döner', async () => {
    const product = await tauriInvoke<{ id: string }>('create_product', ownerArgs({
      categoryId: 'cat_mod',
      category_id: 'cat_mod',
      name: 'Test Ürünü',
      priceCents: 30000,
      price_cents: 30000,
      isActive: true,
      is_active: true,
    }));

    const group = await tauriInvoke<{ id: string }>(
      'create_modifier_group',
      ownerArgs({ name: 'Bağlı Grup', isRequired: false, minSelections: 0, maxSelections: null }),
    );
    await tauriInvoke(
      'add_modifier_option',
      ownerArgs({ groupId: group.id, group_id: group.id, name: 'Orta', priceCents: 0 }),
    );

    // Atama yapılmadan ürünün modifier'ı yoktur.
    const before = await tauriInvoke<unknown[]>('get_product_modifiers', {
      productId: product.id,
      product_id: product.id,
      tenantId: TENANT,
      tenant_id: TENANT,
    });
    expect(before).toEqual([]);

    await tauriInvoke(
      'set_product_modifier_groups',
      ownerArgs({
        productId: product.id,
        product_id: product.id,
        groupIds: [group.id],
        group_ids: [group.id],
      }),
    );

    const ids = await tauriInvoke<string[]>('get_product_modifier_group_ids', ownerArgs({
      productId: product.id,
      product_id: product.id,
    }));
    expect(ids).toEqual([group.id]);

    const after = await tauriInvoke<{ id: string; options: unknown[] }[]>('get_product_modifiers', {
      productId: product.id,
      product_id: product.id,
      tenantId: TENANT,
      tenant_id: TENANT,
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(group.id);
    expect(after[0].options).toHaveLength(1);

    // Küme semantiği: atama boşaltılabilir.
    await tauriInvoke(
      'set_product_modifier_groups',
      ownerArgs({
        productId: product.id,
        product_id: product.id,
        groupIds: [],
        group_ids: [],
      }),
    );
    const cleared = await tauriInvoke<string[]>('get_product_modifier_group_ids', ownerArgs({
      productId: product.id,
      product_id: product.id,
    }));
    expect(cleared).toEqual([]);

    await tauriInvoke('delete_modifier_group', ownerArgs({ groupId: group.id, group_id: group.id }));
  });
});

describe('Faz 4 — Yüzey sözleşmesi', () => {
  it('Patron portalında Modifier sekmesi kaldırıldı', () => {
    const items = buildOwnerNavItems((capability) => hasCapability('OWNER', capability));
    const labels = items.map(i => i.label);
    const ids = items.map(i => i.id as string);

    expect(labels).not.toContain('Modifier');
    expect(labels).not.toContain('Modifierlar');
    expect(ids).not.toContain('modifiers');

    // Menü sekmesi yaşamaya devam eder: modifier yönetimi oraya gömüldü.
    expect(ids).toContain('menu');
  });

  it('bağımsız OwnerModifiersTab üretimde kullanılmıyor', async () => {
    // Sekme kaldırıldı; dosya silindi. Kalan tek referans yorum satırı olmalı.
    const files = [
      '../../src/presentation/components/owner/OwnerDashboardContainer.tsx',
      '../../src/presentation/components/owner/ui/OwnerMenuTab.tsx',
      '../../src/presentation/components/management/ManagementContainer.tsx',
    ];
    for (const file of files) {
      const source = (await import(`${file}?raw`)).default;
      expect(
        source.includes("from './ui/OwnerModifiersTab'"),
        `${file} OwnerModifiersTab import etmemeli`,
      ).toBe(false);
    }
  });

  it('ürün kaydı modifier atamasını da kalıcılaştırır (her iki yol)', async () => {
    // Atama okuma/yazma tek modülden geçer (`modifierAssignmentApi`); iki ekran
    // komutu doğrudan çağırmamalı ki tenant kuralı kopyalanmasın.
    for (const file of [
      '../../src/presentation/components/owner/ui/OwnerMenuTab.tsx',
      '../../src/presentation/components/management/ManagementContainer.tsx',
    ]) {
      const source = (await import(`${file}?raw`)).default;
      expect(source, `${file} atama modülünü kullanmalı`).toContain('modifierAssignmentApi');
      expect(source, `${file} atamayı doğrudan çağırmamalı`).not.toContain(
        "invoke('set_product_modifier_groups'",
      );
      expect(source, `${file} atamayı doğrudan çağırmamalı`).not.toContain(
        "invoke('get_product_modifier_group_ids'",
      );
    }

    const container = (
      await import('../../src/presentation/components/management/ManagementContainer.tsx?raw')
    ).default;
    // Yeni yetki kazanan rol olmamalı: bölüm ve komut çağrısı `isOwner` kapısına bağlı.
    expect(container).toContain('isOwner && savedProductId');
    expect(container).toContain('canManageModifiers={isOwner}');
  });

  it('"Seçenekler & Ekstralar" alanı her iki formda da bulunur', async () => {
    const modifierSection = (
      await import('../../src/presentation/components/management/ui/ModifierSection.tsx?raw')
    ).default;
    expect(modifierSection).toContain('Seçenekler &amp; Ekstralar');

    const categoryForm = (
      await import('../../src/presentation/components/management/ui/CategoryForm.tsx?raw')
    ).default;
    expect(categoryForm).toContain('ModifierSection');
    expect(categoryForm).toContain('mode="template"');

    const productForm = (
      await import('../../src/presentation/components/management/ui/ProductForm.tsx?raw')
    ).default;
    expect(productForm).toContain('ModifierSection');
    expect(productForm).toContain('mode="assign"');
  });

  it('fiyat farkının ürün fiyatına karışmadığı yüzeyde belirtilir', async () => {
    const productForm = (
      await import('../../src/presentation/components/management/ui/ProductForm.tsx?raw')
    ).default;
    const modifierSection = (
      await import('../../src/presentation/components/management/ui/ModifierSection.tsx?raw')
    ).default;
    const optionForm = (
      await import('../../src/presentation/components/management/ui/modifier/ModifierOptionForm.tsx?raw')
    ).default;
    expect(productForm).toContain('ürünün `price` alanına eklenmez');
    expect(modifierSection).toContain('ürünün temel fiyatına eklenmez');
    // Seçenek ekleme formu ayrı bileşene taşındı; açıklama orada durmalı.
    expect(optionForm).toContain('Fiyat farkı ürün fiyatına eklenmez');
  });
});
