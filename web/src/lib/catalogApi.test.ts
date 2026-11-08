import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_CONTRACT_IDS } from '../../../backend/api/src/acceptanceIds';
import { isCatalogResponse } from './catalogApi';

const ids = ACCEPTANCE_CONTRACT_IDS.TEST_A;
const pkg = {
  packageId: ids.packageId, packageVersion: 1, productId: ids.productId,
  name: 'TEST_A Başlangıç', description: 'Sentetik fiyat görünüm testi', sortOrder: 0, highlighted: true,
  featureKeys: ['feat_kds'], features: [{ key: 'feat_kds', name: 'Mutfak ekranı', description: 'Hazırlığı görüntüler.' }],
  deviceLimit: 2, status: 'published',
  price: { priceId: ids.priceId, amountCents: 125_000, currency: 'TRY', interval: 'month', taxBehavior: 'inclusive', version: 1, effectiveAt: '2026-11-07T00:00:00Z' },
};
const catalog = { productId: ids.productId, revision: `sha256-${'a'.repeat(64)}`, packages: [pkg] };

describe('Labs package catalog response', () => {
  it('accepts exact integer-cents published package values', () => {
    expect(isCatalogResponse(catalog)).toBe(true);
  });

  it('rejects fractional cents, unknown features, draft rows, and malformed revisions', () => {
    expect(isCatalogResponse({ ...catalog, packages: [{ ...pkg, price: { ...pkg.price, amountCents: 1250.5 } }] })).toBe(false);
    expect(isCatalogResponse({ ...catalog, packages: [{ ...pkg, featureKeys: ['feat_future'], features: [{ key: 'feat_future', name: 'Gelecek', description: '' }] }] })).toBe(false);
    expect(isCatalogResponse({ ...catalog, packages: [{ ...pkg, status: 'draft' }] })).toBe(false);
    expect(isCatalogResponse({ ...catalog, revision: 'old' })).toBe(false);
  });
});
