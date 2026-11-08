import { createHash, createPublicKey, sign, type KeyObject } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Db, MongoClient } from 'mongodb';
import type { LicenseKeys } from './desktopLicense.js';
import type { Auth } from './lib/auth.js';
import type { TenantCommercialConfig } from './tenantCommercial.js';
import { TENANT_ID, isEffectiveEntitlementResponse } from './contracts/commercialChain.js';
import type { DeviceLicenses } from './sync/deviceLicenses.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type TenantDoc = { _id: string; name: string; country: string; currency: string; timeZone: string; status: 'active'; version: 1; createdAt: Date };
type MembershipDoc = { _id: string; userId: string; tenantId: string; role: 'OWNER'; status: 'active'; version: 1; createdAt: Date };
type Device = { deviceId: string; tenantId: string; label: string; platform: 'windows'; status: 'active' | 'revoked'; registeredAt: string; version: number };
type LicenseClaims = {
  version: 2; keyId: string; tenantId: string; deviceId: string; productId: string;
  entitlementRevision: number; featureKeys: string[]; issuedAt: string; refreshAfter: string;
  offlineUntil: string; paidUntil: string | null; mode: 'active';
  deviceLimit?: number; packageName?: string;
};
const TENANT = { test: (value: string) => TENANT_ID.test(value) || /^tnt_[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value) };
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;
const FEATURE = /^feat_[a-z0-9_]{1,44}$/;

function jsonError(context: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503, code: string, message: string) {
  context.header('Cache-Control', 'no-store');
  return context.json({ code, message }, status);
}

function bearer(context: Context) {
  return /^Bearer (\S+)$/.exec(context.req.header('authorization') ?? '')?.[1] ?? '';
}

function keyId(signingKey: KeyObject) {
  const publicBytes = createHash('sha256').update(createPublicKey(signingKey).export({ format: 'der', type: 'spki' }).subarray(-32)).digest('hex').slice(0, 32);
  return `key_${publicBytes}`;
}

export function mountDesktopTenantDevices(
  app: Hono,
  auth: Auth,
  client: MongoClient,
  db: Db,
  keys: LicenseKeys,
  signingKey: KeyObject | undefined,
  deviceLicenses: DeviceLicenses,
  config: TenantCommercialConfig = {},
) {
  const origin = (config.labsOrigin ?? process.env.LABS_CATALOG_ORIGIN ?? '').replace(/\/$/, '');
  const token = config.labsToken ?? process.env.LABS_CATALOG_TOKEN ?? '';
  const fetcher: Fetcher = config.fetcher ?? fetch;
  const request = (path: string, init: RequestInit) => {
    if (!origin || !token) throw new Error('Tenant device service is not configured');
    return fetcher(`${origin}${path}`, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
    });
  };
  const access = async (context: Context, tenantId: string) => {
    const owner = await keys.find(bearer(context));
    if (!owner) return { response: jsonError(context, 401, 'INVALID_KEY', 'Lisans anahtarı geçersiz.') };
    if (!owner.emailVerified) return { response: jsonError(context, 403, 'EMAIL_NOT_VERIFIED', 'Önce e-postanızı doğrulayın.') };
    if (!TENANT.test(tenantId)) return { response: jsonError(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.') };
    const membership = await db.collection<MembershipDoc>('tenant_membership').findOne({ userId: owner.id, tenantId, role: 'OWNER', status: 'active' });
    const tenant = membership ? await db.collection<TenantDoc>('tenant').findOne({ _id: tenantId, status: 'active' }) : null;
    if (!tenant) return { response: jsonError(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.') };
    return { owner, tenant };
  };
  const link = async (tenant: TenantDoc) => {
    const result = await request(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenant._id)}/bagla`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: tenant.name }),
    });
    if (!result.ok) throw new Error('Ticari işletme kaydı doğrulanamadı.');
    const value: unknown = await result.json().catch(() => null);
    if (!value || typeof value !== 'object' || !('tenantId' in value) || value.tenantId !== tenant._id || !('linked' in value) || value.linked !== true) throw new Error('Ticari işletme kaydı doğrulanamadı.');
  };
  const devices = async (tenantId: string) => {
    const result = await request(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/cihazlar`, { method: 'GET' });
    if (!result.ok) throw new Error('Cihaz kayıtları alınamadı.');
    const value: unknown = await result.json().catch(() => null);
    if (!value || typeof value !== 'object' || !('tenantId' in value) || value.tenantId !== tenantId || !('devices' in value) || !Array.isArray(value.devices)) throw new Error('Cihaz kayıtları doğrulanamadı.');
    const items: Device[] = [];
    for (const candidate of value.devices) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Cihaz kaydı doğrulanamadı.');
      const item = candidate as Record<string, unknown>;
      if (item.tenantId !== tenantId || typeof item.deviceId !== 'string' || !DEVICE.test(item.deviceId) ||
          typeof item.label !== 'string' || (item.platform !== 'windows') ||
          (item.status !== 'active' && item.status !== 'revoked') || typeof item.registeredAt !== 'string' ||
          typeof item.version !== 'number' || !Number.isSafeInteger(item.version) || item.version < 1) {
        throw new Error('Cihaz kaydı doğrulanamadı.');
      }
      items.push(item as Device);
    }
    return items;
  };
  const revoke = async (userId: string, tenantId: string, deviceId: string) => {
    const existing = (await devices(tenantId)).find((device) => device.tenantId === tenantId && device.deviceId === deviceId);
    if (!existing) return null;
    // Labs çağrısı yarıda kalırsa sync standing kapalı kalır; tekrar çağrı güvenle tamamlar.
    await deviceLicenses.recordTenant(userId, tenantId, deviceId, { state: 'revoked', validUntil: null, blocked: true, hasPlan: false });
    if (existing.status === 'revoked') return existing;
    const response = await request(
      `/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/cihazlar/${encodeURIComponent(deviceId)}/iptal`, { method: 'POST' },
    );
    if (!response.ok) throw new Error('Cihaz iptali doğrulanamadı.');
    const value: unknown = await response.json().catch(() => null);
    const result = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (!result || result.tenantId !== tenantId || result.deviceId !== deviceId || result.status !== 'revoked' || typeof result.version !== 'number') {
      throw new Error('Cihaz iptali doğrulanamadı.');
    }
    return result as unknown as Device;
  };
  const revokeError = (context: Context, error: unknown) => error instanceof Error && error.message === 'DEVICE_REVIEW_IN_PROGRESS'
    ? jsonError(context, 409, 'DEVICE_REVIEW_IN_PROGRESS', 'Cihazdaki inceleme kararı tamamlanıyor. Biraz sonra tekrar deneyin.')
    : jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Cihaz kaldırılamadı.');

  app.post('/api/desktop/tenants/:tenantId/activate', async (context) => {
    context.header('Cache-Control', 'no-store');
    const tenantId = context.req.param('tenantId');
    const owner = await keys.find(bearer(context));
    if (!owner) return jsonError(context, 401, 'INVALID_KEY', 'Lisans anahtarı geçersiz.');
    if (!owner.emailVerified) return jsonError(context, 403, 'EMAIL_NOT_VERIFIED', 'Önce e-postanızı doğrulayın.');
    if (!TENANT.test(tenantId)) return jsonError(context, 422, 'INVALID_REQUEST', 'İşletme kimliği geçersiz.');
    const body: unknown = await context.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(context, 422, 'INVALID_REQUEST', 'Cihaz bilgisi geçersiz.');
    const input = body as Record<string, unknown>;
    const deviceId = context.req.header('x-device-id') ?? '';
    if (Object.keys(input).sort().join(',') !== 'label,platform,tenantName' || !DEVICE.test(deviceId) ||
        typeof input.label !== 'string' || !input.label.trim() || [...input.label].length > 80 || input.platform !== 'windows' ||
        typeof input.tenantName !== 'string' || !input.tenantName.trim() || [...input.tenantName].length > 120) {
      return jsonError(context, 422, 'INVALID_REQUEST', 'Cihaz bilgisi geçersiz.');
    }
    const existingTenant = await db.collection<TenantDoc>('tenant').findOne({ _id: tenantId });
    let tenant = existingTenant;
    if (!existingTenant) {
      const now = new Date();
      tenant = { _id: tenantId, name: input.tenantName.trim(), country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul', status: 'active', version: 1, createdAt: now };
      const membership: MembershipDoc = { _id: `mem_${tenantId.slice(4)}`, userId: owner.id, tenantId, role: 'OWNER', status: 'active', version: 1, createdAt: now };
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const tenantExists = await db.collection<TenantDoc>('tenant').findOne({ _id: tenantId }, { session });
          const membershipExists = await db.collection<MembershipDoc>('tenant_membership').findOne({ tenantId, userId: owner.id, role: 'OWNER', status: 'active' }, { session });
          if (tenantExists && !membershipExists) throw new Error('TENANT_TAKEN');
          if (!tenantExists) {
            await db.collection<TenantDoc>('tenant').insertOne(tenant!, { session });
            await db.collection<MembershipDoc>('tenant_membership').insertOne(membership, { session });
          }
        });
      } catch {
        return jsonError(context, 409, 'CONFLICT', 'İşletme eşlemesi çakıştı; listeyi yenileyin.');
      } finally { await session.endSession(); }
    } else {
      const own = await db.collection<MembershipDoc>('tenant_membership').findOne({ tenantId, userId: owner.id, role: 'OWNER', status: 'active' });
      if (!own || existingTenant.status !== 'active') return jsonError(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.');
    }
    try {
      await link(tenant!);
      const upstream = await request(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/cihazlar/${encodeURIComponent(deviceId)}/etkinlestir`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: input.label.trim(), platform: input.platform }),
      });
      if (upstream.status === 409) return jsonError(context, 409, 'DEVICE_LIMIT', 'Cihaz işletmeye bağlanamadı; cihaz limiti dolu veya cihaz başka işletmeye bağlı.');
      if (upstream.status === 403) return jsonError(context, 403, 'NO_ENTITLEMENT', 'İşletmede etkin paket hakkı yok.');
      if (!upstream.ok) return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Cihaz etkinleştirilemedi.');
      const value: unknown = await upstream.json().catch(() => null);
      if (!value || typeof value !== 'object' || !('deviceId' in value) || value.deviceId !== deviceId || !('tenantId' in value) || value.tenantId !== tenantId) {
        return jsonError(context, 502, 'UPSTREAM_UNAVAILABLE', 'Cihaz işletme bağı doğrulanamadı.');
      }
      const rightsResponse = await request(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/hak`, { method: 'GET' });
      const rights: unknown = await rightsResponse.json().catch(() => null);
      if (!rightsResponse.ok || !isEffectiveEntitlementResponse(rights) || rights.tenantId !== tenantId || rights.status !== 'active') {
        return jsonError(context, 403, 'NO_ENTITLEMENT', 'İşletmede etkin paket hakkı yok.');
      }
      await deviceLicenses.recordTenant(owner.id, tenantId, deviceId, {
        state: 'unlicensed', validUntil: null, blocked: false, hasPlan: false,
      });
      return context.json(value, 200);
    } catch {
      return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Cihaz etkinleştirilemedi.');
    }
  });

  const listDevices = async (context: Context, tenantId: string) => {
    context.header('Cache-Control', 'no-store');
    const found = await access(context, tenantId);
    if ('response' in found) return found.response;
    try {
      await link(found.tenant);
      return context.json({ tenantId, devices: await devices(tenantId) });
    } catch { return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Cihaz kayıtları alınamıyor.'); }
  };
  // Boş kasa, hesap sahibinin mevcut işletmelerinden birini seçip ona bağlanabilsin diye listeler.
  // Yalnız anahtar sahibinin OWNER olduğu etkin işletmeler döner; başka hesabın işletmesi görünmez.
  app.get('/api/desktop/tenants', async (context) => {
    context.header('Cache-Control', 'no-store');
    const owner = await keys.find(bearer(context));
    if (!owner) return jsonError(context, 401, 'INVALID_KEY', 'Lisans anahtarı geçersiz.');
    if (!owner.emailVerified) return jsonError(context, 403, 'EMAIL_NOT_VERIFIED', 'Önce e-postanızı doğrulayın.');
    const memberships = await db.collection<MembershipDoc>('tenant_membership')
      .find({ userId: owner.id, role: 'OWNER', status: 'active' }).limit(50).toArray();
    const ids = memberships.map((membership) => membership.tenantId);
    const tenants = ids.length ? await db.collection<TenantDoc>('tenant').find({ _id: { $in: ids }, status: 'active' }).toArray() : [];
    return context.json({ tenants: tenants.map((tenant) => ({ tenantId: tenant._id, name: tenant.name })).sort((a, b) => a.name.localeCompare(b.name, 'tr')) });
  });
  app.get('/api/desktop/tenants/:tenantId/devices', (context) => listDevices(context, context.req.param('tenantId')));
  app.get('/v1/tenants/:tenantId/devices', async (context) => {
    context.header('Cache-Control', 'no-store');
    const tenantId = context.req.param('tenantId');
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return jsonError(context, 401, 'UNAUTHENTICATED', 'Giriş gerekli.');
    const membership = await db.collection<MembershipDoc>('tenant_membership').findOne({ userId: session.user.id, tenantId, role: 'OWNER', status: 'active' });
    const tenant = membership ? await db.collection<TenantDoc>('tenant').findOne({ _id: tenantId, status: 'active' }) : null;
    if (!tenant) return jsonError(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.');
    try { await link(tenant); return context.json({ tenantId, devices: await devices(tenantId) }); }
    catch { return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Cihaz kayıtları alınamıyor.'); }
  });
  app.post('/v1/tenants/:tenantId/devices/:deviceId/revoke', async (context) => {
    context.header('Cache-Control', 'no-store');
    const { tenantId, deviceId } = { tenantId: context.req.param('tenantId'), deviceId: context.req.param('deviceId') };
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return jsonError(context, 401, 'UNAUTHENTICATED', 'Giriş gerekli.');
    const membership = await db.collection<MembershipDoc>('tenant_membership').findOne({ userId: session.user.id, tenantId, role: 'OWNER', status: 'active' });
    if (!membership) return jsonError(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.');
    try {
      const result = await revoke(session.user.id, tenantId, deviceId);
      return result ? context.json(result) : jsonError(context, 404, 'NOT_FOUND', 'Cihaz bulunamadı.');
    } catch (error) { return revokeError(context, error); }
  });
  app.post('/api/desktop/tenants/:tenantId/devices/:deviceId/revoke', async (context) => {
    context.header('Cache-Control', 'no-store');
    const tenantId = context.req.param('tenantId');
    const deviceId = context.req.param('deviceId');
    const found = await access(context, tenantId);
    if ('response' in found) return found.response;
    if (!DEVICE.test(deviceId)) return jsonError(context, 422, 'INVALID_REQUEST', 'Cihaz kimliği geçersiz.');
    try {
      const result = await revoke(found.owner.id, tenantId, deviceId);
      return result ? context.json(result) : jsonError(context, 404, 'NOT_FOUND', 'Cihaz bulunamadı.');
    } catch (error) { return revokeError(context, error); }
  });
  app.post('/api/desktop/tenants/:tenantId/license/refresh', async (context) => {
    context.header('Cache-Control', 'no-store');
    const tenantId = context.req.param('tenantId');
    const found = await access(context, tenantId);
    if ('response' in found) return found.response;
    if (!signingKey) return jsonError(context, 503, 'LICENSE_UNAVAILABLE', 'Lisans imzalama servisi kapalı.');
    const deviceId = context.req.header('x-device-id') ?? '';
    if (!DEVICE.test(deviceId)) return jsonError(context, 422, 'INVALID_REQUEST', 'Cihaz kimliği geçersiz.');
    try {
      await link(found.tenant);
      const [rightsResponse, registeredDevices] = await Promise.all([
        request(`/api/v1/urunler/kasam360/kiracilar/${encodeURIComponent(tenantId)}/hak`, { method: 'GET' }),
        devices(tenantId),
      ]);
      if (!rightsResponse.ok) return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme lisansı doğrulanamadı.');
      const rights: unknown = await rightsResponse.json().catch(() => null);
      if (!isEffectiveEntitlementResponse(rights) || rights.tenantId !== tenantId || rights.status !== 'active') return jsonError(context, 403, 'NO_ENTITLEMENT', 'İşletmede etkin paket hakkı yok.');
      if (!registeredDevices.some((device) => device.tenantId === tenantId && device.deviceId === deviceId && device.status === 'active')) return jsonError(context, 403, 'DEVICE_REVOKED', 'Cihaz bu işletmeye etkin değil.');
      const now = Date.now();
      const paidEnd = rights.validUntil ? Date.parse(rights.validUntil) : 0;
      if (!Number.isFinite(paidEnd) || paidEnd <= now) return jsonError(context, 403, 'NO_ENTITLEMENT', 'İşletme hakkının süresi dolmuş.');
      const offlineUntil = new Date(Math.min(now + 72 * 60 * 60 * 1000, paidEnd)).toISOString();
      const claims: LicenseClaims = {
        version: 2, keyId: keyId(signingKey), tenantId, deviceId, productId: rights.productId,
        entitlementRevision: rights.revision,
        featureKeys: rights.featureKeys.filter((feature) => FEATURE.test(feature)).sort(),
        issuedAt: new Date(now).toISOString(), refreshAfter: new Date(Math.min(now + 24 * 60 * 60 * 1000, Date.parse(offlineUntil))).toISOString(),
        offlineUntil, paidUntil: rights.validUntil, mode: 'active',
        // Native imzayı alan sırasıyla yeniden kurar: yeni alanlar sonda ve yalnız değer varsa yazılır.
        ...(rights.deviceLimit > 0 ? { deviceLimit: rights.deviceLimit } : {}),
        ...(rights.packageName ? { packageName: rights.packageName } : {}),
      };
      const signature = sign(null, Buffer.from(JSON.stringify(claims)), signingKey).toString('base64url');
      await deviceLicenses.recordTenant(found.owner.id, tenantId, deviceId, {
        state: 'active', validUntil: rights.validUntil, paidUntil: rights.validUntil,
        offlineUntil, blocked: false, hasPlan: true,
      });
      return context.json({ ...claims, signature });
    } catch { return jsonError(context, 503, 'UPSTREAM_UNAVAILABLE', 'Lisans şu anda yenilenemiyor.'); }
  });
}
