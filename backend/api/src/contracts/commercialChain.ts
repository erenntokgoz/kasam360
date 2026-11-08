/** C02–C06 servisleri uygulanana kadar yalnız ortak wire şemasıdır. */
export const CONTRACT_REVISION = 'kasam360.commercial.v1-draft.2' as const;

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';
export type Currency = 'TRY' | 'USD' | 'EUR';
export type Interval = 'month' | 'year';
export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired' | 'refunded' | 'suspended';
export type DeviceStatus = 'pending' | 'active' | 'revoked' | 'limit';

export interface AccountRequest { name: string; email: string; password: string }
export interface AccountResponse { userId: string; email: string; emailVerified: boolean }
export interface TenantRequest { businessName: string; country: 'TR'; currency: Currency; timeZone: 'Europe/Istanbul' }
export interface TenantResponse {
  tenant: { tenantId: string; name: string; status: 'active'; version: 1 };
  membership: { userId: string; tenantId: string; role: 'OWNER'; status: 'active'; version: 1 };
}
export interface PackageResponse {
  packageId: string; packageVersion: number; productId: string; name: string; description: string;
  sortOrder: number; highlighted: boolean; featureKeys: string[];
  features: { key: string; name: string; description: string }[];
  deviceLimit: number; status: 'published';
  price: { priceId: string; amountCents: number; currency: Currency; interval: Interval; taxBehavior: 'exclusive' | 'inclusive'; version: number; effectiveAt: string };
}
export interface CatalogResponse { productId: string; revision: string; packages: PackageResponse[] }
export interface EffectiveEntitlementResponse {
  tenantId: string; productId: string; status: 'active' | 'inactive' | 'conflict'; source: 'subscription' | 'manual' | 'none';
  packageId: string | null; packageVersion: number | null; featureKeys: string[]; deviceLimit: number;
  validFrom: string | null; validUntil: string | null; revision: number;
  /** Labs yeni sürümde döner; eski Labs yanıtı bu alan olmadan da geçerlidir. */
  packageName?: string | null;
}
export interface CheckoutIntentRequest { priceId: string }
export interface CheckoutIntentResponse {
  checkoutIntentId: string; tenantId: string; productId: string; packageId: string;
  packageVersion: number; priceId: string; status: 'awaiting_provider' | 'completed';
}
export interface QuoteRequest { priceId: string; billingCountry: 'TR'; currency: Currency }
export interface QuoteResponse {
  quoteId: string; tenantId: string; priceId: string; priceVersion: number;
  subtotalCents: number; taxCents: number; totalCents: number; currency: Currency; expiresAt: string;
}
export interface CheckoutRequest { quoteId: string }
export interface CheckoutResponse { checkoutId: string; status: 'pending'; redirectUrl: string; expiresAt: string }
export interface SubscriptionResponse {
  subscriptionId: string; tenantId: string; packageId: string; packageVersion: number; priceId: string;
  status: SubscriptionStatus; currentPeriodStart: string; currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean; provider: string; environment: 'test' | 'live'; version: number;
}
export interface DeviceResponse { deviceId: string; tenantId: string; label: string; platform: 'windows'; status: DeviceStatus; registeredAt: string }
export interface DeviceLicenseResponse {
  version: 2; keyId: string; tenantId: string; deviceId: string; productId: string;
  entitlementRevision: number; featureKeys: string[]; issuedAt: string; refreshAfter: string;
  offlineUntil: string; paidUntil: string | null; mode: 'active' | 'read_only';
  /** Ekranda gösterim içindir; imzalıdır ama hak kararına katılmaz. Eski belgelerde yoktur. */
  deviceLimit?: number; packageName?: string; signature: string;
}

export type ContractCode =
  | 'INVALID_REQUEST' | 'INVALID_MONEY' | 'UNKNOWN_FEATURE' | 'UNAUTHENTICATED'
  | 'EMAIL_NOT_VERIFIED' | 'TENANT_FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT' | 'RATE_LIMITED' | 'QUOTE_EXPIRED' | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED' | 'DEVICE_LIMIT' | 'DEVICE_REVOKED' | 'LICENSE_UNAVAILABLE'
  | 'OUTCOME_UNKNOWN' | 'UPSTREAM_UNAVAILABLE';
export interface ApiError { code: ContractCode; message: string; correlationId: string; retryable: boolean; fieldErrors?: Record<string, string> }

// Masaüstü kasası işletme kimliğini `tnt_` + 24 küçük onaltılık karakterle üretir (yerel kayıtların hepsi bu
// biçimdedir); web/API ise standart ULID üretir. İkisi de aynı işletme kimliği sözleşmesine girer.
export const TENANT_ID = /^tnt_(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{24})$/;
const ULID_TAIL = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const id = (value: unknown, prefix: string) => typeof value === 'string' &&
  (prefix === 'tnt' ? TENANT_ID.test(value) || new RegExp(`^tnt_${ULID_TAIL}$`, 'i').test(value) : new RegExp(`^${prefix}_${ULID_TAIL}$`, 'i').test(value));
const cents = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const version = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[], optional: string[] = []) =>
  Object.keys(value).every((key) => keys.includes(key) || optional.includes(key)) && keys.every((key) => key in value);
const enumValue = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T);
const currencies = ['TRY', 'USD', 'EUR'] as const;
const intervals = ['month', 'year'] as const;
const features = new Set(['feat_kds', 'feat_qr_menu', 'feat_delivery', 'feat_caller_id', 'feat_table_order', 'feat_seat_split', 'feat_recipe_bom', 'feat_dynamic_pricing', 'feat_ledger_cari', 'feat_multi_branch', 'feat_loss_radar']);
const featureList = (value: unknown): value is string[] => Array.isArray(value) && value.every((key) => typeof key === 'string' && features.has(key)) && new Set(value).size === value.length;
interface CatalogFeature { key: string; name: string; description: string }
const catalogFeatures = (value: unknown): value is CatalogFeature[] => Array.isArray(value) && value.every((feature) =>
  record(feature) && exact(feature, ['key', 'name', 'description']) && typeof feature.key === 'string' && features.has(feature.key) &&
  typeof feature.name === 'string' && feature.name.length > 0 && typeof feature.description === 'string' && feature.description.length <= 240,
);

function priceIsValid(value: unknown): boolean {
  if (!record(value) || !exact(value, ['priceId', 'amountCents', 'currency', 'interval', 'taxBehavior', 'version', 'effectiveAt'])) return false;
  return id(value.priceId, 'prc') && cents(value.amountCents) && enumValue(value.currency, currencies) &&
    enumValue(value.interval, intervals) && enumValue(value.taxBehavior, ['exclusive', 'inclusive']) && version(value.version) && date(value.effectiveAt);
}

export function isAccountRequest(value: unknown): value is AccountRequest {
  return record(value) && exact(value, ['name', 'email', 'password']) && typeof value.name === 'string' &&
    value.name.trim().length > 0 && [...value.name].length <= 120 && typeof value.email === 'string' &&
    value.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
    typeof value.password === 'string' && new TextEncoder().encode(value.password).length >= 12 && new TextEncoder().encode(value.password).length <= 128;
}

export function isTenantRequest(value: unknown): value is TenantRequest {
  return record(value) && exact(value, ['businessName', 'country', 'currency', 'timeZone']) &&
    typeof value.businessName === 'string' && value.businessName.trim().length > 0 && [...value.businessName].length <= 120 &&
    value.country === 'TR' && enumValue(value.currency, currencies) && value.timeZone === 'Europe/Istanbul';
}

export function isPackageResponse(value: unknown): value is PackageResponse {
  if (!record(value) || !exact(value, ['packageId', 'packageVersion', 'productId', 'name', 'description', 'sortOrder', 'highlighted', 'featureKeys', 'features', 'deviceLimit', 'status', 'price']) || !record(value.price)) return false;
  if (!featureList(value.featureKeys) || !catalogFeatures(value.features)) return false;
  const featureKeys = value.featureKeys;
  const packageFeatures = value.features;
  return id(value.packageId, 'pkg') && version(value.packageVersion) && id(value.productId, 'prd') &&
    typeof value.name === 'string' && value.name.length > 0 && typeof value.description === 'string' && value.description.length <= 300 &&
    Number.isSafeInteger(value.sortOrder) && typeof value.sortOrder === 'number' && value.sortOrder >= 0 &&
    typeof value.highlighted === 'boolean' && packageFeatures.length === featureKeys.length && packageFeatures.every((feature) => featureKeys.includes(feature.key)) &&
    Number.isSafeInteger(value.deviceLimit) && typeof value.deviceLimit === 'number' && value.deviceLimit >= 1 && value.deviceLimit <= 999 &&
    value.status === 'published' && priceIsValid(value.price);
}

export function isCatalogResponse(value: unknown): value is CatalogResponse {
  return record(value) && exact(value, ['productId', 'revision', 'packages']) && id(value.productId, 'prd') &&
    typeof value.revision === 'string' && /^sha256-[0-9a-f]{64}$/.test(value.revision) && Array.isArray(value.packages) &&
    value.packages.every(isPackageResponse) && value.packages.every((pkg) => pkg.productId === value.productId);
}

export function isEffectiveEntitlementResponse(value: unknown): value is EffectiveEntitlementResponse {
  if (!record(value) || !exact(value, ['tenantId', 'productId', 'status', 'source', 'packageId', 'packageVersion', 'featureKeys', 'deviceLimit', 'validFrom', 'validUntil', 'revision'], ['packageName'])) return false;
  if ('packageName' in value && value.packageName !== null && (typeof value.packageName !== 'string' || [...value.packageName].length > 80)) return false;
  const validDate = (candidate: unknown) => candidate === null || date(candidate);
  if (!id(value.tenantId, 'tnt') || !id(value.productId, 'prd') || !enumValue(value.status, ['active', 'inactive', 'conflict']) ||
      !enumValue(value.source, ['subscription', 'manual', 'none']) || !featureList(value.featureKeys) ||
      !Number.isSafeInteger(value.deviceLimit) || typeof value.deviceLimit !== 'number' || value.deviceLimit < 0 || value.deviceLimit > 999 ||
      !Number.isSafeInteger(value.revision) || typeof value.revision !== 'number' || value.revision < 0 ||
      !validDate(value.validFrom) || !validDate(value.validUntil)) return false;
  if (value.status === 'active') return value.source !== 'none' && id(value.packageId, 'pkg') && version(value.packageVersion) && value.deviceLimit > 0 && typeof value.validFrom === 'string' && typeof value.validUntil === 'string' && Date.parse(value.validUntil) > Date.parse(value.validFrom);
  return value.source === 'none' && value.packageId === null && value.packageVersion === null && value.featureKeys.length === 0 && value.deviceLimit === 0 && value.validFrom === null && value.validUntil === null;
}

export function isCheckoutIntentRequest(value: unknown): value is CheckoutIntentRequest {
  return record(value) && exact(value, ['priceId']) && id(value.priceId, 'prc');
}

export function isCheckoutIntentResponse(value: unknown): value is CheckoutIntentResponse {
  return record(value) && exact(value, ['checkoutIntentId', 'tenantId', 'productId', 'packageId', 'packageVersion', 'priceId', 'status']) &&
    id(value.checkoutIntentId, 'chk') && id(value.tenantId, 'tnt') && id(value.productId, 'prd') && id(value.packageId, 'pkg') &&
    version(value.packageVersion) && id(value.priceId, 'prc') && enumValue(value.status, ['awaiting_provider', 'completed']);
}

export function isQuoteRequest(value: unknown): value is QuoteRequest {
  return record(value) && exact(value, ['priceId', 'billingCountry', 'currency']) && id(value.priceId, 'prc') &&
    value.billingCountry === 'TR' && enumValue(value.currency, currencies);
}

export function isQuoteResponse(value: unknown): value is QuoteResponse {
  if (!record(value) || !exact(value, ['quoteId', 'tenantId', 'priceId', 'priceVersion', 'subtotalCents', 'taxCents', 'totalCents', 'currency', 'expiresAt'])) return false;
  return id(value.quoteId, 'qte') && id(value.tenantId, 'tnt') && id(value.priceId, 'prc') && version(value.priceVersion) &&
    cents(value.subtotalCents) && cents(value.taxCents) && cents(value.totalCents) &&
    Number.isSafeInteger((value.subtotalCents as number) + (value.taxCents as number)) &&
    value.totalCents === (value.subtotalCents as number) + (value.taxCents as number) &&
    enumValue(value.currency, currencies) && date(value.expiresAt);
}

export function isCheckoutRequest(value: unknown): value is CheckoutRequest {
  return record(value) && exact(value, ['quoteId']) && id(value.quoteId, 'qte');
}

export function isCheckoutResponse(value: unknown): value is CheckoutResponse {
  if (!record(value) || !exact(value, ['checkoutId', 'status', 'redirectUrl', 'expiresAt'])) return false;
  if (typeof value.redirectUrl !== 'string') return false;
  try { const url = new URL(value.redirectUrl); return id(value.checkoutId, 'chk') && value.status === 'pending' && url.protocol === 'https:' && date(value.expiresAt); }
  catch { return false; }
}

export function isSubscriptionResponse(value: unknown): value is SubscriptionResponse {
  if (!record(value) || !exact(value, ['subscriptionId', 'tenantId', 'packageId', 'packageVersion', 'priceId', 'status', 'currentPeriodStart', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'provider', 'environment', 'version'])) return false;
  const periodStart = value['currentPeriodStart'];
  const periodEnd = value['currentPeriodEnd'];
  return id(value.subscriptionId, 'sub') && id(value.tenantId, 'tnt') && id(value.packageId, 'pkg') && version(value.packageVersion) && id(value.priceId, 'prc') &&
    enumValue(value.status, ['pending', 'active', 'past_due', 'canceled', 'expired', 'refunded', 'suspended']) &&
    date(periodStart) && date(periodEnd) && Date.parse(periodEnd) > Date.parse(periodStart) &&
    typeof value.cancelAtPeriodEnd === 'boolean' && typeof value.provider === 'string' && value.provider.length > 0 &&
    enumValue(value.environment, ['test', 'live']) && version(value.version);
}

export function isDeviceResponse(value: unknown): value is DeviceResponse {
  if (!record(value) || !exact(value, ['deviceId', 'tenantId', 'label', 'platform', 'status', 'registeredAt'])) return false;
  return id(value.deviceId, 'dev') && id(value.tenantId, 'tnt') && typeof value.label === 'string' && value.label.length > 0 &&
    value.platform === 'windows' && enumValue(value.status, ['pending', 'active', 'revoked', 'limit']) && date(value.registeredAt);
}

export function isDeviceLicenseResponse(value: unknown): value is DeviceLicenseResponse {
  if (!record(value) || !exact(value, ['version', 'keyId', 'tenantId', 'deviceId', 'productId', 'entitlementRevision', 'featureKeys', 'issuedAt', 'refreshAfter', 'offlineUntil', 'paidUntil', 'mode', 'signature'], ['deviceLimit', 'packageName'])) return false;
  if ('deviceLimit' in value && (!Number.isSafeInteger(value.deviceLimit) || typeof value.deviceLimit !== 'number' || value.deviceLimit < 1 || value.deviceLimit > 999)) return false;
  if ('packageName' in value && (typeof value.packageName !== 'string' || [...value.packageName].length > 80)) return false;
  return value.version === 2 && typeof value.keyId === 'string' && /^key_[a-f0-9]{32}$/.test(value.keyId) && id(value.tenantId, 'tnt') && id(value.deviceId, 'dev') && id(value.productId, 'prd') &&
    version(value.entitlementRevision) && featureList(value.featureKeys) && date(value.issuedAt) && date(value.refreshAfter) && date(value.offlineUntil) &&
    (value.paidUntil === null || date(value.paidUntil)) && enumValue(value.mode, ['active', 'read_only']) && typeof value.signature === 'string' && value.signature.length >= 80;
}

export function isApiError(value: unknown): value is ApiError {
  if (!record(value)) return false;
  const allowed = ['code', 'message', 'correlationId', 'retryable', 'fieldErrors'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  const code = value['code'];
  const message = value['message'];
  const correlationId = value['correlationId'];
  const retryable = value['retryable'];
  if (typeof code !== 'string' || typeof message !== 'string' || typeof correlationId !== 'string' || typeof retryable !== 'boolean') return false;
  if (!id(correlationId, 'cor')) return false;
  if ('fieldErrors' in value) {
    const fieldErrors = value['fieldErrors'];
    if (!record(fieldErrors)) return false;
    for (const fieldError of Object.values(fieldErrors)) {
      if (typeof fieldError !== 'string') return false;
    }
  }
  return true;
}
