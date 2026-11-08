import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_CONTRACT_IDS as ids } from '../acceptanceFixtures.js';
import {
  CONTRACT_REVISION, isAccountRequest, isApiError, isCheckoutRequest, isCheckoutResponse, isCheckoutIntentRequest, isCheckoutIntentResponse, isEffectiveEntitlementResponse,
  isCatalogResponse, isDeviceLicenseResponse, isDeviceResponse, isPackageResponse, isQuoteRequest, isQuoteResponse,
  isSubscriptionResponse, isTenantRequest,
} from './commercialChain.js';

const tenantA = ids.TEST_A;
const good = {
  account: { name: 'Ayşe Yılmaz', email: 'ayse@example.test', password: 'Guclu-Sifre-012' },
  tenant: { businessName: 'TEST_A Kafe', country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul' },
  pkg: { packageId: tenantA.packageId, packageVersion: 1, productId: tenantA.productId, name: 'Test Paket', description: 'TEST_A test paketi', sortOrder: 0, highlighted: false, featureKeys: ['feat_kds', 'feat_table_order'], features: [{ key: 'feat_kds', name: 'Mutfak', description: 'Mutfak ekranı' }, { key: 'feat_table_order', name: 'Masa Siparişi', description: 'Masa siparişi' }], deviceLimit: 2, status: 'published', price: { priceId: tenantA.priceId, amountCents: 100000, currency: 'TRY', interval: 'month', taxBehavior: 'exclusive', version: 1, effectiveAt: '2026-11-06T12:00:00Z' } },
  quoteRequest: { priceId: tenantA.priceId, billingCountry: 'TR', currency: 'TRY' },
  quote: { quoteId: tenantA.quoteId, tenantId: tenantA.tenantId, priceId: tenantA.priceId, priceVersion: 1, subtotalCents: 100000, taxCents: 0, totalCents: 100000, currency: 'TRY', expiresAt: '2026-11-06T12:00:00Z' },
  checkoutRequest: { quoteId: tenantA.quoteId },
  checkout: { checkoutId: tenantA.checkoutId, status: 'pending', redirectUrl: 'https://payments.example.test/session/abc', expiresAt: '2026-11-06T12:05:00Z' },
  checkoutIntentRequest: { priceId: tenantA.priceId },
  checkoutIntent: { checkoutIntentId: tenantA.checkoutId, tenantId: tenantA.tenantId, productId: tenantA.productId, packageId: tenantA.packageId, packageVersion: 1, priceId: tenantA.priceId, status: 'awaiting_provider' },
  entitlement: { tenantId: tenantA.tenantId, productId: tenantA.productId, status: 'active', source: 'manual', packageId: tenantA.packageId, packageVersion: 1, featureKeys: ['feat_kds', 'feat_table_order'], deviceLimit: 2, validFrom: '2026-11-06T10:00:00Z', validUntil: '2026-12-06T10:00:00Z', revision: 1793968800000 },
  noEntitlement: { tenantId: ids.TEST_B.tenantId, productId: ids.TEST_B.productId, status: 'inactive', source: 'none', packageId: null, packageVersion: null, featureKeys: [], deviceLimit: 0, validFrom: null, validUntil: null, revision: 0 },
  subscription: { subscriptionId: tenantA.subscriptionId, tenantId: tenantA.tenantId, packageId: tenantA.packageId, packageVersion: 1, priceId: tenantA.priceId, status: 'active', currentPeriodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: false, provider: 'lemonsqueezy', environment: 'test', version: 1 },
  device: { deviceId: tenantA.deviceId, tenantId: tenantA.tenantId, label: 'Kasa 1', platform: 'windows', status: 'active', registeredAt: '2026-11-06T10:00:00Z' },
  license: { version: 2, keyId: tenantA.keyId, tenantId: tenantA.tenantId, deviceId: tenantA.deviceId, productId: tenantA.productId, entitlementRevision: 1, featureKeys: ['feat_kds'], issuedAt: '2026-11-06T10:00:00Z', refreshAfter: '2026-11-07T10:00:00Z', offlineUntil: '2026-11-09T10:00:00Z', paidUntil: '2026-12-01T00:00:00Z', mode: 'active', signature: 'A'.repeat(88) },
  error: { code: 'TENANT_FORBIDDEN', message: 'İşletmeye erişim yok.', correlationId: tenantA.correlationId, retryable: false },
};

describe('commercial contract revision fixture', () => {
  it('accepts complete valid chain examples', () => {
    expect(CONTRACT_REVISION).toBe('kasam360.commercial.v1-draft.2');
    expect(isAccountRequest(good.account)).toBe(true);
    expect(isTenantRequest(good.tenant)).toBe(true);
    expect(isPackageResponse(good.pkg)).toBe(true);
    expect(isCatalogResponse({ productId: tenantA.productId, revision: `sha256-${'a'.repeat(64)}`, packages: [good.pkg] })).toBe(true);
    expect(isQuoteRequest(good.quoteRequest)).toBe(true);
    expect(isQuoteResponse(good.quote)).toBe(true);
    expect(isCheckoutRequest(good.checkoutRequest)).toBe(true);
    expect(isCheckoutResponse(good.checkout)).toBe(true);
    expect(isCheckoutIntentRequest(good.checkoutIntentRequest)).toBe(true);
    expect(isCheckoutIntentResponse(good.checkoutIntent)).toBe(true);
    expect(isEffectiveEntitlementResponse(good.entitlement)).toBe(true);
    expect(isEffectiveEntitlementResponse({ ...good.entitlement, featureKeys: [] })).toBe(true);
    expect(isEffectiveEntitlementResponse({ ...good.entitlement, validFrom: '2026-11-06T22:29:04.5066971Z' })).toBe(true);
    expect(isEffectiveEntitlementResponse(good.noEntitlement)).toBe(true);
    expect(isSubscriptionResponse(good.subscription)).toBe(true);
    expect(isDeviceResponse(good.device)).toBe(true);
    expect(isDeviceLicenseResponse(good.license)).toBe(true);
    expect(isApiError(good.error)).toBe(true);
  });

  it('rejects malformed money, tenant-less data, unknown enum and unsafe redirects', () => {
    expect(isQuoteResponse({ ...good.quote, totalCents: 100000.5 })).toBe(false);
    expect(isQuoteResponse({ ...good.quote, totalCents: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    const { tenantId: _tenantId, ...tenantless } = good.quote;
    expect(isQuoteResponse(tenantless)).toBe(false);
    expect(isQuoteResponse({ ...good.quote, tenantId: ids.TEST_B.tenantId })).toBe(true);
    expect(isPackageResponse({ ...good.pkg, featureKeys: ['feat_future_unknown'] })).toBe(false);
    expect(isCheckoutResponse({ ...good.checkout, redirectUrl: 'http://payments.example.test/session/abc' })).toBe(false);
    expect(isCheckoutIntentResponse({ ...good.checkoutIntent, tenantId: ids.TEST_B.tenantId })).toBe(true);
    expect(isEffectiveEntitlementResponse({ ...good.entitlement, tenantId: ids.TEST_B.tenantId })).toBe(true);
    expect(isEffectiveEntitlementResponse({ ...good.entitlement, status: 'active', source: 'none' })).toBe(false);
    expect(isEffectiveEntitlementResponse({ ...good.noEntitlement, deviceLimit: 2 })).toBe(false);
    expect(isSubscriptionResponse({ ...good.subscription, status: 'success' })).toBe(false);
    expect(isDeviceLicenseResponse({ ...good.license, tenantId: undefined })).toBe(false);
    expect(isApiError({ ...good.error, retryable: 'true' })).toBe(false);
  });

  it('requires explicit idempotency metadata for mutating target operations at the HTTP boundary', () => {
    const key = '123e4567-e89b-42d3-a456-426614174000';
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)).toBe(true);
    expect(isCheckoutRequest({ ...good.checkoutRequest, idempotencyKey: key })).toBe(false);
  });
});
