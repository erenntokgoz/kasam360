export type Currency = 'TRY' | 'USD' | 'EUR';
export type Interval = 'month' | 'year';

export interface CatalogFeature { key: string; name: string; description: string }
export interface CatalogPackage {
  packageId: string;
  packageVersion: number;
  productId: string;
  name: string;
  description: string;
  sortOrder: number;
  highlighted: boolean;
  featureKeys: string[];
  features: CatalogFeature[];
  deviceLimit: number;
  status: 'published';
  price: {
    priceId: string;
    amountCents: number;
    currency: Currency;
    interval: Interval;
    taxBehavior: 'inclusive' | 'exclusive';
    version: number;
    effectiveAt: string;
  };
}
export interface CatalogResponse { productId: string; revision: string; packages: CatalogPackage[] }

const FEATURES = new Set(['feat_kds', 'feat_qr_menu', 'feat_delivery', 'feat_caller_id', 'feat_table_order', 'feat_seat_split', 'feat_recipe_bom', 'feat_dynamic_pricing', 'feat_ledger_cari', 'feat_multi_branch', 'feat_loss_radar']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const prefixedId = (value: unknown, prefix: string) => typeof value === 'string' && new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`, 'i').test(value);
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value));

function isFeature(value: unknown): value is CatalogFeature {
  return record(value) && exact(value, ['key', 'name', 'description']) && typeof value.key === 'string' && FEATURES.has(value.key) &&
    typeof value.name === 'string' && value.name.length > 0 && typeof value.description === 'string' && value.description.length <= 240;
}

function isPackage(value: unknown): value is CatalogPackage {
  if (!record(value) || !exact(value, ['packageId', 'packageVersion', 'productId', 'name', 'description', 'sortOrder', 'highlighted', 'featureKeys', 'features', 'deviceLimit', 'status', 'price']) || !record(value.price)) return false;
  if (!Array.isArray(value.featureKeys) || !value.featureKeys.every((key): key is string => typeof key === 'string' && FEATURES.has(key)) ||
      !Array.isArray(value.features) || !value.features.every(isFeature)) return false;
  const featureKeys = value.featureKeys;
  const packageFeatures = value.features;
  const price = value.price;
  return prefixedId(value.packageId, 'pkg') && Number.isSafeInteger(value.packageVersion) && Number(value.packageVersion) > 0 &&
    prefixedId(value.productId, 'prd') && typeof value.name === 'string' && value.name.length > 0 &&
    typeof value.description === 'string' && value.description.length <= 300 && Number.isSafeInteger(value.sortOrder) && Number(value.sortOrder) >= 0 &&
    typeof value.highlighted === 'boolean' && packageFeatures.length === featureKeys.length &&
    packageFeatures.every((feature) => featureKeys.includes(feature.key)) && Number.isSafeInteger(value.deviceLimit) && Number(value.deviceLimit) >= 1 && Number(value.deviceLimit) <= 999 && value.status === 'published' &&
    exact(price, ['priceId', 'amountCents', 'currency', 'interval', 'taxBehavior', 'version', 'effectiveAt']) && prefixedId(price.priceId, 'prc') &&
    Number.isSafeInteger(price.amountCents) && Number(price.amountCents) > 0 && ['TRY', 'USD', 'EUR'].includes(String(price.currency)) &&
    ['month', 'year'].includes(String(price.interval)) && ['inclusive', 'exclusive'].includes(String(price.taxBehavior)) &&
    Number.isSafeInteger(price.version) && Number(price.version) > 0 && timestamp(price.effectiveAt);
}

export function isCatalogResponse(value: unknown): value is CatalogResponse {
  return record(value) && exact(value, ['productId', 'revision', 'packages']) && prefixedId(value.productId, 'prd') &&
    typeof value.revision === 'string' && /^sha256-[0-9a-f]{64}$/.test(value.revision) && Array.isArray(value.packages) &&
    value.packages.every(isPackage) && value.packages.every((item) => item.productId === value.productId);
}

export async function loadCatalog(apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000'): Promise<CatalogResponse> {
  const response = await fetch(`${apiOrigin.replace(/\/$/, '')}/v1/catalog?productId=kasam360`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Paket kataloğu şu anda alınamıyor.');
  const value: unknown = await response.json().catch(() => null);
  if (!isCatalogResponse(value)) throw new Error('Paket kataloğu doğrulanamadı.');
  return value;
}
