import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { Context, Hono } from 'hono';
import type { Auth } from './lib/auth.js';
import { isCheckoutIntentRequest, isCheckoutIntentResponse, isEffectiveEntitlementResponse } from './contracts/commercialChain.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface TenantCommercialConfig { labsOrigin?: string; labsToken?: string; fetcher?: Fetcher }
interface TenantRow { _id: string; name: string; status: 'active' }
interface MembershipRow { userId: string; tenantId: string; role: string; status: string }

type ErrorStatus = 400 | 401 | 404 | 409 | 422 | 502 | 503;

function error(context: Context, status: ErrorStatus, code: string, message: string) {
  context.header('Cache-Control', 'no-store');
  return context.json({ code, message, correlationId: randomUUID(), retryable: status >= 500 }, status);
}

function validIdempotencyKey(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function mountTenantCommercial(app: Hono, auth: Auth, db: Db, config: TenantCommercialConfig = {}) {
  const origin = (config.labsOrigin ?? process.env.LABS_CATALOG_ORIGIN ?? '').replace(/\/$/, '');
  const token = config.labsToken ?? process.env.LABS_CATALOG_TOKEN ?? '';
  const fetcher = config.fetcher ?? fetch;

  const ownerTenant = async (context: Context, tenantId: string) => {
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return { failure: error(context, 401, 'UNAUTHENTICATED', 'Giriş gerekli.') };
    const membership = await db.collection<MembershipRow>('tenant_membership').findOne({
      tenantId, userId: session.user.id, role: 'OWNER', status: 'active',
    });
    if (!membership) return { failure: error(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.') };
    const tenant = await db.collection<TenantRow>('tenant').findOne({ _id: tenantId, status: 'active' });
    if (!tenant) return { failure: error(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.') };
    return { tenant };
  };

  const labsRequest = async (path: string, init: RequestInit) => {
    if (!origin || !token) throw new Error('Labs integration is not configured');
    return fetcher(`${origin}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(5000),
    });
  };

  app.put('/v1/tenants/:tenantId/commercial-link', async (context) => {
    const tenantId = context.req.param('tenantId');
    const access = await ownerTenant(context, tenantId);
    if ('failure' in access) return access.failure;
    try {
      const response = await labsRequest(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/bagla`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: access.tenant.name }),
      });
      if (!response.ok) return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme ticari kaydı şu anda eşitlenemiyor.');
      const value: unknown = await response.json().catch(() => null);
      if (!value || typeof value !== 'object' || !('tenantId' in value) || value.tenantId !== tenantId || !('linked' in value) || value.linked !== true) {
        return error(context, 502, 'UPSTREAM_UNAVAILABLE', 'İşletme bağı doğrulanamadı.');
      }
      context.header('Cache-Control', 'no-store');
      return context.json({ tenantId, linked: true });
    } catch {
      return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme ticari kaydı şu anda eşitlenemiyor.');
    }
  });

  app.get('/v1/tenants/:tenantId/entitlement', async (context) => {
    const tenantId = context.req.param('tenantId');
    const access = await ownerTenant(context, tenantId);
    if ('failure' in access) return access.failure;
    try {
      const rightsPath = `/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/hak`;
      let response = await labsRequest(rightsPath, { method: 'GET' });
      if (response.status === 404) {
        // Yeni işletme Labs'e ilk okumada bağlanır; bağ kurulmadan "yetki yok" göstermek sahibi yanıltır.
        // Bağ idempotenttir ve yalnız oturumdaki OWNER'ın kendi işletmesi için çağrılır.
        const linked = await labsRequest(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/bagla`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: access.tenant.name }),
        });
        if (!linked.ok) return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme ticari kaydı şu anda eşitlenemiyor.');
        response = await labsRequest(rightsPath, { method: 'GET' });
      }
      if (response.status === 404) return error(context, 404, 'NOT_FOUND', 'İşletmenin ticari kaydı bulunamadı.');
      if (!response.ok) return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme hakları şu anda alınamıyor.');
      const value: unknown = await response.json().catch(() => null);
      if (!isEffectiveEntitlementResponse(value) || value.tenantId !== tenantId) return error(context, 502, 'UPSTREAM_UNAVAILABLE', 'İşletme hakları doğrulanamadı.');
      context.header('Cache-Control', 'no-store');
      return context.json(value);
    } catch {
      return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme hakları şu anda alınamıyor.');
    }
  });

  app.post('/v1/tenants/:tenantId/checkout-intents', async (context) => {
    const tenantId = context.req.param('tenantId');
    const access = await ownerTenant(context, tenantId);
    if ('failure' in access) return access.failure;
    const idempotencyKey = context.req.header('idempotency-key');
    if (!validIdempotencyKey(idempotencyKey)) return error(context, 400, 'INVALID_REQUEST', 'Idempotency-Key UUIDv4 gerekli.');
    const input: unknown = await context.req.json().catch(() => null);
    if (!isCheckoutIntentRequest(input)) return error(context, 422, 'INVALID_REQUEST', 'Fiyat seçimi geçersiz.');
    try {
      const response = await labsRequest('/api/v1/urunler/kasam360/checkout-intents', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, tenantName: access.tenant.name, priceId: input.priceId, idempotencyKey }),
      });
      if (response.status === 409) return error(context, 409, 'IDEMPOTENCY_CONFLICT', 'Fiyat yayını değişti veya anahtar farklı istekle kullanıldı.');
      if (!response.ok) return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'Checkout kaydı şu anda oluşturulamıyor.');
      const value: unknown = await response.json().catch(() => null);
      if (!isCheckoutIntentResponse(value) || value.tenantId !== tenantId || value.priceId !== input.priceId) return error(context, 502, 'UPSTREAM_UNAVAILABLE', 'Checkout kaydı doğrulanamadı.');
      context.header('Cache-Control', 'no-store');
      return context.json(value, 201);
    } catch {
      return error(context, 503, 'UPSTREAM_UNAVAILABLE', 'Checkout kaydı şu anda oluşturulamıyor.');
    }
  });
}
