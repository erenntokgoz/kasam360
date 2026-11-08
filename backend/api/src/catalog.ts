import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { isCatalogResponse } from './contracts/commercialChain.js';

type CatalogFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CatalogConfig {
  labsOrigin?: string;
  labsToken?: string;
  fetcher?: CatalogFetch;
}

export function mountCatalog(app: Hono, config: CatalogConfig = {}) {
  const labsOrigin = (config.labsOrigin ?? process.env.LABS_CATALOG_ORIGIN ?? '').replace(/\/$/, '');
  const labsToken = config.labsToken ?? process.env.LABS_CATALOG_TOKEN ?? '';
  const fetcher = config.fetcher ?? fetch;

  app.get('/v1/catalog', async (context) => {
    context.header('Cache-Control', 'no-store');
    const productId = context.req.query('productId');
    if (productId !== 'kasam360') {
      return context.json({ code: 'INVALID_REQUEST', message: 'Ürün kodu geçersiz.', correlationId: randomUUID(), retryable: false }, 400);
    }
    if (!labsOrigin || !labsToken) {
      return context.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paket kataloğu şu anda alınamıyor.', correlationId: randomUUID(), retryable: true }, 503);
    }
    try {
      const response = await fetcher(`${labsOrigin}/api/v1/urunler/kasam360/katalog`, {
        headers: { Authorization: `Bearer ${labsToken}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return context.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paket kataloğu şu anda alınamıyor.', correlationId: randomUUID(), retryable: true }, 503);
      }
      const value: unknown = await response.json().catch(() => null);
      if (!isCatalogResponse(value)) {
        return context.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paket kataloğu doğrulanamadı.', correlationId: randomUUID(), retryable: true }, 502);
      }
      context.header('ETag', `"${value.revision}"`);
      return context.json(value);
    } catch {
      return context.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paket kataloğu şu anda alınamıyor.', correlationId: randomUUID(), retryable: true }, 503);
    }
  });
}
