// Menü Yönetimi için Tarayıcı Mock IPC Yanıtlayıcısı
// Gerçek Tauri IPC yokken (tarayıcı test/geliştirme) bellek tabanlı deterministik veri sağlar.
// Tüm finansal alanlar INTEGER kuruş (cents) cinsindendir. Backend kontratlarıyla %100 uyumludur.

import { SEED_CATEGORIES, SEED_PRODUCTS } from './productFixture';
import type {
  ProductDto,
  CategoryDto,
  ModifierGroupDto,
  ModifierOptionDto,
  PriceListDto,
  BulkPriceResult,
  BulkPriceChange,
  RecipeInputDto,
} from '../types/menu360';

// Bellek İçi Menü Verileri
let mockManagementProducts: ProductDto[] = SEED_PRODUCTS.map((p) => ({
  id: p.id,
  categoryId: p.categoryId,
  name: p.name,
  priceCents: p.unitPriceCents,
  isActive: p.isAvailable,
  is86: false,
  defaultStation: p.station,
  stockUnit: 'adet',
}));

let mockCategories: CategoryDto[] = SEED_CATEGORIES.filter((c) => c.id !== 'cat_all').map((c) => ({
  id: c.id,
  name: c.name,
  displayOrder: c.orderIndex,
  defaultStation:
    c.id === 'cat_drink' || c.id === 'cat_coffee'
      ? 'BAR'
      : c.id === 'cat_dessert'
      ? 'TATLI'
      : 'MUTFAK',
}));

let mockModifierGroups: ModifierGroupDto[] = [
  {
    id: 'mg_sauce',
    name: 'Sos Tercihi',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    options: [
      { id: 'opt_mantar', modifierGroupId: 'mg_sauce', name: 'Mantar Sosu', priceCents: 4500, priceDeltaCents: 4500, displayOrder: 1 },
      { id: 'opt_biber', modifierGroupId: 'mg_sauce', name: 'Karabiber Sosu', priceCents: 4000, priceDeltaCents: 4000, displayOrder: 2 },
      { id: 'opt_demiglace', modifierGroupId: 'mg_sauce', name: 'Demiglace Sos', priceCents: 5000, priceDeltaCents: 5000, displayOrder: 3 },
    ],
  },
  {
    id: 'mg_extra',
    name: 'Ekstra Tercihler',
    isRequired: false,
    minSelections: 0,
    maxSelections: 3,
    options: [
      { id: 'opt_cheddar', modifierGroupId: 'mg_extra', name: 'Ekstra Cheddar', priceCents: 3500, priceDeltaCents: 3500, displayOrder: 1 },
      { id: 'opt_jalapeno', modifierGroupId: 'mg_extra', name: 'Jalapeno Turşu', priceCents: 1500, priceDeltaCents: 1500, displayOrder: 2 },
    ],
  },
];
const mockProductModifierGroupIds = new Map<string, string[]>();
const mockStockBatches: Array<{
  id: string; product_id: string; product_name: string; remaining_quantity: number;
  unit_cost_cents: number; received_at: string; expiry_date: null; stock_unit: string;
}> = [];
const mockSuppliers: Array<{ id: string; name: string }> = [];
const mockPurchaseOrders: Array<{
  id: string; supplier_id: string; order_number: string; status: string; total_cents: number;
}> = [];
const mockPurchaseLines = new Map<string, Array<{
  productId: string; quantity: number; unitCostCents: number;
}>>();

function mockLineCost(quantity: number, unitCostCents: number): number {
  const micros = BigInt(Math.round(quantity * 1_000_000));
  if (micros <= 0n || !Number.isSafeInteger(unitCostCents)) throw new Error('Geçersiz alış tutarı.');
  const cents = (micros * BigInt(unitCostCents) + 500_000n) / 1_000_000n;
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) throw new Error('Alış tutarı sınırı aşıldı.');
  return result;
}
const mockRecipeCosts = new Map<string, {
  recipe_id: string;
  product_id: string;
  unit_cost_cents: null;
  unresolved: string[];
  components: Array<{
    component_product_id: string;
    name: string;
    quantity: number;
    unit: string;
    unit_cost_cents: null;
    line_cost_cents: null;
  }>;
}>();

let mockPriceLists: PriceListDto[] = [
  {
    id: 'pl_night',
    name: 'Gece Tarifesi',
    kind: 'PERAKENDE',
    description: '23:00 - 04:00 saatleri arası servis tarifesi',
    isActive: true,
    items: [],
  },
];

export function handleManagementMockIPC<T>(
  command: string,
  args: Record<string, unknown>
): T | null {
  switch (command) {
    case 'get_management_products': {
      return mockManagementProducts as unknown as T;
    }

    case 'create_product': {
      const pData = args as {
        categoryId: string;
        name: string;
        priceCents: number;
        isActive?: boolean;
        barcode?: string;
        description?: string;
      };
      const cat = mockCategories.find((c) => c.id === pData.categoryId);
      const newProd: ProductDto = {
        id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        categoryId: pData.categoryId,
        name: pData.name,
        priceCents: pData.priceCents,
        barcode: pData.barcode,
        description: pData.description,
        isActive: pData.isActive !== undefined ? pData.isActive : true,
        is86: false,
        defaultStation: cat?.defaultStation || 'BAR',
        stockUnit: typeof args.stockUnit === 'string' ? args.stockUnit : 'adet',
      };
      mockManagementProducts.unshift(newProd);
      return newProd as unknown as T;
    }

    case 'update_product': {
      const pData = args as {
        id?: string;
        productId?: string;
        name: string;
        priceCents: number;
        categoryId?: string;
        barcode?: string;
        description?: string;
        isActive?: boolean;
      };
      const prodId = pData.id || pData.productId;
      mockManagementProducts = mockManagementProducts.map((p) =>
        p.id === prodId
          ? {
              ...p,
              name: pData.name,
              priceCents: pData.priceCents,
              categoryId: pData.categoryId || p.categoryId,
              barcode: pData.barcode,
              description: pData.description,
              isActive: pData.isActive !== undefined ? pData.isActive : p.isActive,
              stockUnit: typeof args.stockUnit === 'string' ? args.stockUnit : p.stockUnit,
            }
          : p
      );
      const found = mockManagementProducts.find((p) => p.id === prodId);
      return (found || null) as unknown as T;
    }

    case 'update_product_status': {
      const pData = args as { id?: string; productId?: string; isActive: boolean };
      const prodId = pData.id || pData.productId;
      mockManagementProducts = mockManagementProducts.map((p) =>
        p.id === prodId ? { ...p, isActive: pData.isActive } : p
      );
      return { success: true } as unknown as T;
    }

    case 'set_product_86d_command': {
      const nestArgs = (args.args || {}) as { productId?: string; is86d?: boolean; reason?: string };
      const prodId = nestArgs.productId || (args.productId as string);
      const is86 = nestArgs.is86d !== undefined ? nestArgs.is86d : (args.is86d as boolean);
      const reason = nestArgs.reason || (args.reason as string | undefined);

      mockManagementProducts = mockManagementProducts.map((p) =>
        p.id === prodId ? { ...p, is86, stockoutReason: reason } : p
      );
      return true as unknown as T;
    }

    case 'delete_product': {
      const pData = args as { id?: string; productId?: string };
      const prodId = pData.id || pData.productId;
      mockManagementProducts = mockManagementProducts.filter((p) => p.id !== prodId);
      return { success: true } as unknown as T;
    }

    case 'get_management_categories': {
      return mockCategories as unknown as T;
    }

    case 'create_category': {
      const cData = args as {
        name: string;
        displayOrder?: number;
        defaultStation?: string;
      };
      const newCat: CategoryDto = {
        id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: cData.name,
        displayOrder: cData.displayOrder || mockCategories.length + 1,
        defaultStation: cData.defaultStation || 'BAR',
      };
      mockCategories.push(newCat);
      return newCat as unknown as T;
    }

    case 'delete_category': {
      const cData = args as { id?: string; categoryId?: string };
      const catId = cData.id || cData.categoryId;
      if (mockManagementProducts.some((product) => product.categoryId === catId)) {
        throw new Error('VALIDATION: Ürün içeren kategori silinemez.');
      }
      mockCategories = mockCategories.filter((c) => c.id !== catId);
      return { success: true } as unknown as T;
    }

    case 'get_modifier_groups': {
      return mockModifierGroups as unknown as T;
    }

    case 'list_stock_batches_command':
      return mockStockBatches as unknown as T;

    case 'get_inventory_suppliers':
      return mockSuppliers as unknown as T;

    case 'upsert_supplier_command': {
      const input = args.args as { name: string };
      if (!input?.name?.trim()) throw new Error('VALIDATION: tedarikçi adı gerekli');
      const supplier = { id: `sup_demo_${Date.now()}`, name: input.name.trim() };
      mockSuppliers.push(supplier);
      return supplier as T;
    }

    case 'list_purchase_orders_command':
      return mockPurchaseOrders as unknown as T;

    case 'create_purchase_order_command': {
      const input = args.args as { supplierId: string; orderNumber: string; items: Array<{
        productId: string; quantity: number; unitCostCents: number;
      }> };
      if (!mockSuppliers.some((supplier) => supplier.id === input.supplierId) ||
          !input.orderNumber?.trim() || !input.items?.length) {
        throw new Error('VALIDATION: geçerli tedarikçi ve sipariş kalemi gerekli');
      }
      const total = input.items.reduce((sum, item) => {
        if (!mockManagementProducts.some((product) => product.id === item.productId)) {
          throw new Error('NOT_FOUND: ürün bulunamadı');
        }
        return sum + mockLineCost(item.quantity, item.unitCostCents);
      }, 0);
      if (!Number.isSafeInteger(total)) throw new Error('Alış tutarı sınırı aşıldı.');
      const order = { id: `por_demo_${Date.now()}`, supplier_id: input.supplierId,
        order_number: input.orderNumber.trim(), status: 'TASI', total_cents: total };
      mockPurchaseOrders.unshift(order);
      mockPurchaseLines.set(order.id, input.items);
      return order as T;
    }

    case 'receive_purchase_order_command': {
      const { orderId } = args as { orderId: string };
      const order = mockPurchaseOrders.find((candidate) => candidate.id === orderId);
      if (!order || order.status !== 'TASI') throw new Error('CONFLICT: sipariş alınamaz');
      const lines = mockPurchaseLines.get(orderId) ?? [];
      for (const line of lines) {
        const product = mockManagementProducts.find((candidate) => candidate.id === line.productId);
        if (!product) throw new Error('NOT_FOUND: ürün bulunamadı');
        mockStockBatches.push({ id: `bat_demo_${Date.now()}_${mockStockBatches.length}`,
          product_id: product.id, product_name: product.name,
          stock_unit: product.stockUnit ?? 'adet',
          remaining_quantity: line.quantity, unit_cost_cents: line.unitCostCents,
          received_at: new Date().toISOString(), expiry_date: null });
      }
      order.status = 'ALINDI';
      return order.total_cents as T;
    }

    case 'get_product_modifier_group_ids': {
      const { productId } = args as { productId: string };
      if (!mockManagementProducts.some((product) => product.id === productId)) {
        throw new Error('NOT_FOUND: ürün bulunamadı');
      }
      return (mockProductModifierGroupIds.get(productId) ?? []) as unknown as T;
    }

    case 'set_product_modifier_groups': {
      const { productId, groupIds } = args as { productId: string; groupIds: string[] };
      if (!mockManagementProducts.some((product) => product.id === productId) ||
          groupIds.some((id) => !mockModifierGroups.some((group) => group.id === id))) {
        throw new Error('NOT_FOUND: ürün veya seçenek grubu bulunamadı');
      }
      mockProductModifierGroupIds.set(productId, [...groupIds]);
      return undefined as T;
    }

    case 'create_modifier_group': {
      const gData = args as {
        name: string;
        minSelections?: number;
        maxSelections?: number;
        isRequired?: boolean;
      };
      const id = `mg_${Date.now()}`;
      const newGrp: ModifierGroupDto = {
        id,
        name: gData.name,
        isRequired: gData.isRequired || false,
        minSelections: gData.minSelections || 0,
        maxSelections: gData.maxSelections || 1,
        options: [],
      };
      mockModifierGroups.push(newGrp);
      return id as unknown as T;
    }

    case 'delete_modifier_group': {
      const gData = args as { groupId: string };
      mockModifierGroups = mockModifierGroups.filter((g) => g.id !== gData.groupId);
      return { success: true } as unknown as T;
    }

    case 'add_modifier_option': {
      const oData = args as {
        groupId: string;
        name: string;
        priceCents?: number;
        priceDeltaCents?: number;
      };
      const price = oData.priceCents !== undefined ? oData.priceCents : (oData.priceDeltaCents || 0);
      const id = `opt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const opt: ModifierOptionDto = {
        id,
        modifierGroupId: oData.groupId,
        name: oData.name,
        priceCents: price,
        priceDeltaCents: price,
        displayOrder: 1,
      };
      mockModifierGroups = mockModifierGroups.map((g) =>
        g.id === oData.groupId ? { ...g, options: [...g.options, opt] } : g
      );
      return id as unknown as T;
    }

    case 'list_price_lists': {
      return mockPriceLists as unknown as T;
    }

    case 'create_price_list_command': {
      const nestArgs = (args.args || {}) as { name?: string; kind?: string };
      const name = nestArgs.name || (args.name as string);
      const kind = nestArgs.kind || 'PERAKENDE';
      const desc = args.description as string | undefined;
      const newPl: PriceListDto = {
        id: `pl_${Date.now()}`,
        name,
        kind,
        description: desc,
        isActive: true,
        items: [],
      };
      mockPriceLists.push(newPl);
      return newPl as unknown as T;
    }

    case 'delete_price_list_command': {
      const plData = args as { id?: string; priceListId?: string };
      const listId = plData.id || plData.priceListId;
      mockPriceLists = mockPriceLists.filter((pl) => pl.id !== listId);
      return true as unknown as T;
    }

    case 'bulk_update_product_prices': {
      // Backend expects `args: { categoryId, productIds, percent, byCents }`
      const nestArgs = (args.args || args.input || {}) as {
        categoryId?: string;
        productIds?: string[];
        percent?: number;
        byCents?: number;
        updateType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
        value?: number;
      };

      const categoryId = nestArgs.categoryId;
      const productIds = nestArgs.productIds;
      const percent = nestArgs.percent ?? (nestArgs.updateType === 'PERCENTAGE' ? nestArgs.value : undefined);
      const byCents = nestArgs.byCents ?? (nestArgs.updateType === 'FIXED_AMOUNT' ? nestArgs.value : undefined);

      const changed: BulkPriceChange[] = [];
      mockManagementProducts = mockManagementProducts.map((p) => {
        const matchesCategory = categoryId ? p.categoryId === categoryId : true;
        const matchesIds = productIds ? productIds.includes(p.id) : true;
        const target = (categoryId ? matchesCategory : true) && (productIds ? matchesIds : matchesCategory);

        if (target) {
          let newPrice = p.priceCents;
          if (percent !== undefined) {
            const delta = Math.round((p.priceCents * percent) / 100);
            newPrice = Math.max(0, p.priceCents + delta);
          } else if (byCents !== undefined) {
            newPrice = Math.max(0, p.priceCents + Math.round(byCents));
          }
          changed.push({
            productId: p.id,
            productName: p.name,
            oldPriceCents: p.priceCents,
            newPriceCents: newPrice,
          });
          return { ...p, priceCents: newPrice };
        }
        return p;
      });

      const res: BulkPriceResult = { changed, skipped: [] };
      return res as unknown as T;
    }

    case 'create_recipe_command': {
      const input = args.args as RecipeInputDto;
      if (!input?.productId || !input.items?.length || mockRecipeCosts.has(input.productId)) {
        throw new Error('VALIDATION: geçerli ürün ve malzeme gerekli; aktif reçete tek olabilir');
      }
      const components = input.items.map((item) => {
        const product = mockManagementProducts.find((candidate) => candidate.id === item.componentProductId);
        if (!product || item.componentProductId === input.productId) {
          throw new Error('NOT_FOUND: malzeme ürünü bulunamadı');
        }
        return {
          component_product_id: product.id,
          name: product.name,
          quantity: item.quantity,
          unit: item.unit,
          unit_cost_cents: null,
          line_cost_cents: null,
        };
      });
      const recipeId = `rcp_demo_${Date.now()}`;
      mockRecipeCosts.set(input.productId, {
        recipe_id: recipeId,
        product_id: input.productId,
        unit_cost_cents: null,
        unresolved: components.map((component) => component.name),
        components,
      });
      return { id: recipeId, product_id: input.productId } as T;
    }

    case 'deactivate_recipe_command': {
      const { recipeId } = args.args as { recipeId: string };
      const match = [...mockRecipeCosts.entries()].find(([, recipe]) => recipe.recipe_id === recipeId);
      if (!match) throw new Error('NOT_FOUND: reçete bulunamadı');
      mockRecipeCosts.delete(match[0]);
      return undefined as T;
    }

    case 'get_recipe_cost': {
      const { productId } = args.args as { productId: string };
      const cost = mockRecipeCosts.get(productId);
      if (!cost) throw new Error('NOT_FOUND: bu ürün için aktif reçete tanımlı değil');
      return cost as T;
    }

    default:
      return null;
  }
}
