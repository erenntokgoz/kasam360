import type { BulkPriceResult, CategoryDto, PriceListDto, ProductDto } from '../types/menu360';

interface WireProduct {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  is_active: boolean;
  sku: string | null;
  barcode: string | null;
  tax_rate_bp: number | null;
  description: string | null;
  color: string | null;
  is_86: boolean;
  stockout_reason: string | null;
  stock_unit: string;
}

interface WireCategory {
  id: string;
  name: string;
  display_order: number;
  icon: string | null;
  default_station: string | null;
}

interface WirePriceList {
  id: string;
  name: string;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  items: { id: string; product_id: string; product_name: string; price_cents: number }[];
}

interface WireBulkPriceResult {
  changed: { product_id: string; product_name: string; old_price_cents: number; new_price_cents: number; skipped: string | null }[];
  skipped: { product_id: string; product_name: string; old_price_cents: number; new_price_cents: number; skipped: string | null }[];
  category_id: string | null;
}

export function mapProduct(wire: WireProduct | ProductDto): ProductDto {
  if (!('category_id' in wire)) return wire;
  if (!Number.isSafeInteger(wire.price_cents)) throw new Error('Ürün fiyatı geçersiz.');
  return {
    id: wire.id,
    categoryId: wire.category_id,
    name: wire.name,
    priceCents: wire.price_cents,
    imageUrl: wire.image_url ?? undefined,
    isActive: wire.is_active,
    sku: wire.sku ?? undefined,
    barcode: wire.barcode ?? undefined,
    taxRateBp: wire.tax_rate_bp ?? undefined,
    description: wire.description ?? undefined,
    color: wire.color ?? undefined,
    is86: wire.is_86,
    stockoutReason: wire.stockout_reason ?? undefined,
    stockUnit: wire.stock_unit,
  };
}

export function mapCategory(wire: WireCategory | CategoryDto): CategoryDto {
  if (!('display_order' in wire)) return wire;
  return {
    id: wire.id,
    name: wire.name,
    displayOrder: wire.display_order,
    icon: wire.icon ?? undefined,
    defaultStation: wire.default_station ?? '',
  };
}

export function mapPriceList(wire: WirePriceList | PriceListDto): PriceListDto {
  if (!('is_active' in wire)) return wire;
  return {
    id: wire.id,
    name: wire.name,
    kind: wire.kind,
    validFrom: wire.valid_from ?? undefined,
    validTo: wire.valid_to ?? undefined,
    isActive: wire.is_active,
    items: wire.items.map((item) => ({
      id: item.id,
      priceListId: wire.id,
      productId: item.product_id,
      priceCents: item.price_cents,
    })),
  };
}

export function mapBulkPriceResult(wire: WireBulkPriceResult | BulkPriceResult): BulkPriceResult {
  if (!('category_id' in wire)) return wire;
  const mapChange = (item: WireBulkPriceResult['changed'][number]) => ({
    productId: item.product_id,
    productName: item.product_name,
    oldPriceCents: item.old_price_cents,
    newPriceCents: item.new_price_cents,
  });
  return {
    changed: wire.changed.map(mapChange),
    skipped: wire.skipped.map(mapChange),
    categoryId: wire.category_id ?? undefined,
  };
}
