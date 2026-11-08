import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceFixtures.js';
import { mountCatalog } from './catalog.js';

const ids = ACCEPTANCE_CONTRACT_IDS.TEST_A;
const catalog = {
  productId: ids.productId,
  revision: `sha256-${'a'.repeat(64)}`,
  packages: [{
    packageId: ids.packageId,
    packageVersion: 1,
    productId: ids.productId,
    name: 'TEST_A Başlangıç',
    description: 'TEST_A geçici katalog verisi',
    sortOrder: 0,
    highlighted: false,
    featureKeys: ['feat_kds'],
    features: [{ key: 'feat_kds', name: 'Mutfak ekranı', description: 'Sipariş hazırlığını görüntüler.' }],
    deviceLimit: 2,
    status: 'published',
    price: { priceId: ids.priceId, amountCents: 125_000, currency: 'TRY', interval: 'month', taxBehavior: 'inclusive', version: 1, effectiveAt: '2026-11-07T00:00:00Z' },
  }],
};

describe('Labs catalog projection', () => {
  it('proxies the validated published catalog without exposing its service credential', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer labs_private_server_secret');
      return Response.json(catalog, { headers: { etag: `"${catalog.revision}"` } });
    });
    const app = new Hono();
    mountCatalog(app, { labsOrigin: 'https://labs.example.test', labsToken: 'labs_private_server_secret', fetcher });
    const response = await app.request('/v1/catalog?productId=kasam360');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBe(`"${catalog.revision}"`);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(catalog);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(body).not.toContain('labs_private_server_secret');
  });

  it('fails closed when the Labs source is absent or returns an invalid catalog', async () => {
    const unavailable = new Hono();
    mountCatalog(unavailable, {});
    expect((await unavailable.request('/v1/catalog?productId=kasam360')).status).toBe(503);

    const invalid = new Hono();
    mountCatalog(invalid, { labsOrigin: 'https://labs.example.test', labsToken: 'labs_secret', fetcher: async () => Response.json({ packages: [] }) });
    expect((await invalid.request('/v1/catalog?productId=kasam360')).status).toBe(502);
  });

  it('rejects product selectors outside the published product key', async () => {
    const fetcher = vi.fn();
    const app = new Hono();
    mountCatalog(app, { labsOrigin: 'https://labs.example.test', labsToken: 'labs_secret', fetcher });
    expect((await app.request('/v1/catalog?productId=another')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
