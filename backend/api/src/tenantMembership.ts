import { MongoClient, MongoServerError, type Db } from 'mongodb';
import type { Hono } from 'hono';
import type { Auth } from './lib/auth.js';
import { prefixedId } from './lib/prefixedId.js';

interface TenantDoc { _id: string; name: string; country: string; currency: string; timeZone: string; status: 'active'; version: 1; createdAt: Date }
interface MembershipDoc { _id: string; userId: string; tenantId: string; role: 'OWNER'; status: 'active'; version: 1; createdAt: Date }
const tenantWire = ({ _id, ...tenant }: TenantDoc) => ({ tenantId: _id, ...tenant });
const membershipWire = ({ _id, ...membership }: MembershipDoc) => ({ membershipId: _id, ...membership });
const valid = (body: unknown): body is { businessName: string; country: 'TR'; currency: 'TRY' | 'USD' | 'EUR'; timeZone: 'Europe/Istanbul' } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return Object.keys(value).sort().join(',') === 'businessName,country,currency,timeZone' &&
    typeof value.businessName === 'string' && value.businessName.trim().length > 0 && [...value.businessName].length <= 120 &&
    value.country === 'TR' && ['TRY', 'USD', 'EUR'].includes(String(value.currency)) && value.timeZone === 'Europe/Istanbul';
};

export function mountTenantMembership(app: Hono, auth: Auth, client: MongoClient, db: Db) {
  const tenants = db.collection<TenantDoc>('tenant');
  const memberships = db.collection<MembershipDoc>('tenant_membership');
  app.post('/v1/tenants', async (context) => {
    context.header('Cache-Control', 'no-store');
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ code: 'UNAUTHENTICATED', message: 'Giriş gerekli.' }, 401);
    if (!session.user.emailVerified) return context.json({ code: 'EMAIL_NOT_VERIFIED', message: 'Önce e-postanızı doğrulayın.' }, 403);
    const body: unknown = await context.req.json().catch(() => null);
    if (!valid(body)) return context.json({ code: 'INVALID_REQUEST', message: 'İşletme bilgileri geçersiz.' }, 422);
    const key = context.req.header('idempotency-key') ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      return context.json({ code: 'INVALID_REQUEST', message: 'Idempotency-Key gerekli.' }, 400);
    }
    const now = new Date();
    const requestHash = JSON.stringify(body);
    const idempotency = db.collection<{ userId: string; key: string; requestHash: string; tenantId: string }>('tenant_creation_idempotency');
    const old = await idempotency.findOne({ userId: session.user.id, key });
    if (old) {
      if (old.requestHash !== requestHash) return context.json({ code: 'IDEMPOTENCY_CONFLICT', message: 'Anahtar farklı istekle kullanıldı.' }, 409);
      const tenant = await tenants.findOne({ _id: old.tenantId });
      const membership = await memberships.findOne({ tenantId: old.tenantId, userId: session.user.id, role: 'OWNER', status: 'active' });
      if (tenant && membership) return context.json({ tenant: tenantWire(tenant), membership: membershipWire(membership) }, 200);
    }
    const tenantId = prefixedId('tenant');
    const tenant: TenantDoc = { _id: tenantId, name: body.businessName.trim(), country: body.country, currency: body.currency, timeZone: body.timeZone, status: 'active', version: 1, createdAt: now };
    const membership: MembershipDoc = { _id: prefixedId('membership'), userId: session.user.id, tenantId, role: 'OWNER', status: 'active', version: 1, createdAt: now };
    const transaction = client.startSession();
    try {
      await transaction.withTransaction(async () => {
        const race = await idempotency.findOne({ userId: session.user.id, key }, { session: transaction });
        if (race) throw new MongoServerError({ message: 'IDEMPOTENCY_RACE', code: 11000 });
        await tenants.insertOne(tenant, { session: transaction });
        await memberships.insertOne(membership, { session: transaction });
        await idempotency.insertOne({ userId: session.user.id, key, requestHash, tenantId }, { session: transaction });
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const replay = await idempotency.findOne({ userId: session.user.id, key });
        if (replay?.requestHash === requestHash) {
          const savedTenant = await tenants.findOne({ _id: replay.tenantId });
          const savedMembership = await memberships.findOne({ tenantId: replay.tenantId, userId: session.user.id, role: 'OWNER', status: 'active' });
          if (savedTenant && savedMembership) return context.json({ tenant: tenantWire(savedTenant), membership: membershipWire(savedMembership) }, 200);
        }
        return context.json({ code: 'CONFLICT', message: 'İşletme oluşturma çakıştı; aynı anahtarla tekrar deneyin.' }, 409);
      }
      throw error;
    } finally { await transaction.endSession(); }
    return context.json({ tenant: tenantWire(tenant), membership: membershipWire(membership) }, 201);
  });

  app.get('/v1/tenants', async (context) => {
    context.header('Cache-Control', 'no-store');
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ code: 'UNAUTHENTICATED', message: 'Giriş gerekli.' }, 401);
    const membershipsForUser = await memberships.find({ userId: session.user.id, status: 'active' }).sort({ createdAt: 1, _id: 1 }).toArray();
    const tenantIds = membershipsForUser.map((membership) => membership.tenantId);
    const tenantRows = tenantIds.length ? await tenants.find({ _id: { $in: tenantIds } }).toArray() : [];
    const tenantById = new Map(tenantRows.map((tenant) => [tenant._id, tenant]));
    return context.json({ tenants: membershipsForUser.flatMap((membership) => {
      const tenant = tenantById.get(membership.tenantId);
      return tenant ? [{ tenant: tenantWire(tenant), membership: membershipWire(membership) }] : [];
    }) });
  });

  app.get('/v1/tenants/:tenantId', async (context) => {
    context.header('Cache-Control', 'no-store');
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ code: 'UNAUTHENTICATED', message: 'Giriş gerekli.' }, 401);
    const tenantId = context.req.param('tenantId');
    const membership = await memberships.findOne({ tenantId, userId: session.user.id, status: 'active' });
    if (!membership) return context.json({ code: 'NOT_FOUND', message: 'İşletme bulunamadı.' }, 404);
    const tenant = await tenants.findOne({ _id: tenantId });
    return tenant ? context.json({ tenant: tenantWire(tenant), membership: membershipWire(membership) }) : context.json({ code: 'NOT_FOUND', message: 'İşletme bulunamadı.' }, 404);
  });
}

export async function ensureTenantMembershipIndexes(db: Db) {
  await Promise.all([
    db.collection('tenant').createIndex({ _id: 1 }, { unique: true }),
    db.collection('tenant_membership').createIndex({ userId: 1, tenantId: 1 }, { unique: true }),
    db.collection('tenant_creation_idempotency').createIndex({ userId: 1, key: 1 }, { unique: true }),
  ]);
}
