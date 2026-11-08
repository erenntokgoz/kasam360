import { generateKeyPairSync, verify } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceIds.js';
import { mongoLicenseKeys } from './desktopLicense.js';
import { mountDesktopTenantDevices } from './desktopTenantDevices.js';
import { TENANT_ID, isDeviceLicenseResponse, isEffectiveEntitlementResponse } from './contracts/commercialChain.js';
import { mongoDeviceLicenses } from './sync/deviceLicenses.js';
import type { DeviceLicenses } from './sync/deviceLicenses.js';
import { startTestDatabases, type TestDatabases } from './testDb.js';

const A = ACCEPTANCE_CONTRACT_IDS.TEST_A;
const B = ACCEPTANCE_CONTRACT_IDS.TEST_B;
const DEVICE = 'dev_01arz3ndektsv4rrffq69g5fa9';
let db: TestDatabases;
let app: Hono;
let key: string;
let ownerId: string;
let publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];
let deviceLicenses: DeviceLicenses;
let activeDevices: { deviceId: string; tenantId: string; label: string; platform: 'windows'; status: 'active' | 'revoked'; registeredAt: string; version: number }[];
let revokeUnavailable: boolean;
let effectiveFeatureKeys: string[];

beforeAll(async () => { db = await startTestDatabases(); }, 120_000);
afterAll(async () => db?.stop());
beforeEach(async () => {
  await db.reset();
  const now = new Date();
  ownerId = A.ownerId;
  await db.account.collection<{ _id?: string } & Record<string, unknown>>('user').insertOne({ _id: ownerId, name: 'TEST OWNER', email: A.email, emailVerified: true, createdAt: now, updatedAt: now });
  const otherId = B.ownerId;
  await db.account.collection<{ _id?: string } & Record<string, unknown>>('user').insertOne({ _id: otherId, name: 'OTHER OWNER', email: B.email, emailVerified: true, createdAt: now, updatedAt: now });
  for (const tenant of [A, B]) {
    await db.account.collection<{ _id?: string } & Record<string, unknown>>('tenant').insertOne({ _id: tenant.tenantId, name: tenant.businessName, country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul', status: 'active', version: 1, createdAt: now });
    await db.account.collection('tenant_membership').insertOne({ userId: ownerId, tenantId: tenant.tenantId, role: 'OWNER', status: 'active', version: 1, createdAt: now });
  }
  const keys = mongoLicenseKeys(db.account);
  key = await keys.create(ownerId);
  activeDevices = [];
  revokeUnavailable = false;
  effectiveFeatureKeys = ['feat_kds'];
  const pair = generateKeyPairSync('ed25519');
  publicKey = pair.publicKey;
  const appKey = pair.privateKey;
  deviceLicenses = mongoDeviceLicenses(db.account);
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const tenantId = /kiracilar\/([^/]+)/.exec(url)?.[1] ?? '';
    if (url.endsWith('/bagla')) return Response.json({ tenantId, linked: true });
    if (url.endsWith('/hak')) return Response.json({ tenantId, productId: A.productId, status: 'active', source: 'manual', packageId: A.packageId, packageVersion: 1, featureKeys: effectiveFeatureKeys, deviceLimit: 1, validFrom: '2026-11-07T00:00:00Z', validUntil: '2027-11-07T00:00:00Z', revision: 100 });
    if (url.endsWith('/cihazlar') && init?.method === 'GET') return Response.json({ tenantId, devices: activeDevices.filter((device) => device.tenantId === tenantId) });
    const match = /cihazlar\/([^/]+)\/(etkinlestir|iptal)$/.exec(url);
    if (match?.[2] === 'etkinlestir') {
      const deviceId = match[1] ?? '';
      const existing = activeDevices.find((device) => device.deviceId === deviceId);
      if (existing && existing.tenantId !== tenantId) return Response.json({ message: 'already bound' }, { status: 409 });
      if (!existing && activeDevices.filter((device) => device.tenantId === tenantId && device.status === 'active').length >= 1) return Response.json({ message: 'limit' }, { status: 409 });
      if (!existing) activeDevices.push({ deviceId, tenantId, label: 'TEST Kasa', platform: 'windows', status: 'active', registeredAt: new Date().toISOString(), version: 1 });
      return Response.json(activeDevices.find((device) => device.deviceId === deviceId));
    }
    if (match?.[2] === 'iptal') {
      if (revokeUnavailable) return Response.json({ message: 'offline' }, { status: 503 });
      const device = activeDevices.find((entry) => entry.deviceId === match[1] && entry.tenantId === tenantId);
      if (!device) return Response.json({ message: 'missing' }, { status: 404 });
      device.status = 'revoked';
      device.version += 1;
      return Response.json(device);
    }
    return Response.json({ message: 'not found' }, { status: 404 });
  };
  app = new Hono();
  const auth = { api: { getSession: async () => null } } as never;
  mountDesktopTenantDevices(app, auth, db.accountClient, db.account, keys, appKey, deviceLicenses, {
    labsOrigin: 'http://127.0.0.1:3600', labsToken: 'isolated-test-token', fetcher,
  });
});

const activate = (tenantId: string, deviceId = DEVICE) => app.request(`/api/desktop/tenants/${tenantId}/activate`, {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': deviceId, 'content-type': 'application/json' },
  body: JSON.stringify({ tenantName: A.businessName, label: 'TEST Kasa', platform: 'windows' }),
});

describe('tenant cihazı ve V2 lisansı', () => {
  it('boş kasaya yalnız anahtar sahibinin işletmelerini listeler', async () => {
    const list = (bearerKey: string) => app.request('/api/desktop/tenants', { headers: { authorization: `Bearer ${bearerKey}` } });
    expect((await list('lk_invalid')).status).toBe(401);
    const foreign = 'tnt_01a1b8581f0c0025ba7fe599';
    await db.account.collection<{ _id?: string } & Record<string, unknown>>('tenant').insertOne({ _id: foreign, name: 'Başka Hesap', country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul', status: 'active', version: 1, createdAt: new Date() });
    await db.account.collection('tenant_membership').insertOne({ userId: B.ownerId, tenantId: foreign, role: 'OWNER', status: 'active', version: 1, createdAt: new Date() });
    const listed = await (await list(key)).json() as { tenants: { tenantId: string }[] };
    const ids = listed.tenants.map((tenant) => tenant.tenantId);
    expect(ids).toEqual(expect.arrayContaining([A.tenantId, B.tenantId]));
    expect(ids).not.toContain(foreign);
  });

  it('masaüstünün yerel işletme kimliği biçimini kabul eder, biçimsiz kimliği reddeder', async () => {
    const native = 'tnt_01a1b8581f0c0025ba7fe531';
    expect(TENANT_ID.test(native)).toBe(true);
    expect(TENANT_ID.test('tnt_01A1B8581F0C0025BA7FE531')).toBe(false);
    expect((await activate(native, 'dev_native_format_check')).status).not.toBe(422);
    expect((await activate('tnt_bad', 'dev_native_format_check')).status).toBe(422);
  });

  it('aynı cihazı tekrar etkinleştirir, tenant değişimini reddeder, V2 imzasını doğrular ve iptali uygular', async () => {
    expect(isEffectiveEntitlementResponse({ tenantId: A.tenantId, productId: A.productId, status: 'active', source: 'manual', packageId: A.packageId, packageVersion: 1, featureKeys: ['feat_kds'], deviceLimit: 1, validFrom: '2026-11-07T00:00:00Z', validUntil: '2027-11-07T00:00:00Z', revision: 100 })).toBe(true);
    const first = await activate(A.tenantId);
    expect(first.status).toBe(200);
    expect(await deviceLicenses.standingForTenant(ownerId, A.tenantId, DEVICE)).toBe('inactive');
    expect(await deviceLicenses.standingForTenant(ownerId, B.tenantId, DEVICE)).toBe('unknown');
    expect(await activate(A.tenantId)).toMatchObject({ status: 200 });
    const wrongTenant = await activate(B.tenantId);
    expect(wrongTenant.status).toBe(409);
    const listed = await app.request(`/api/desktop/tenants/${A.tenantId}/devices`, { headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(await listed.json()).toMatchObject({ tenantId: A.tenantId, devices: [{ deviceId: DEVICE, tenantId: A.tenantId, status: 'active' }] });
    const license = await app.request(`/api/desktop/tenants/${A.tenantId}/license/refresh`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    const signed: unknown = await license.json();
    expect(isDeviceLicenseResponse(signed)).toBe(true);
    expect(signed).toMatchObject({ version: 2, tenantId: A.tenantId, deviceId: DEVICE, productId: A.productId, featureKeys: ['feat_kds'], mode: 'active' });
    expect(signed).toHaveProperty('signature');
    expect(signed).toHaveProperty('deviceLimit');
    if (!signed || typeof signed !== 'object' || !('signature' in signed) || typeof signed.signature !== 'string') throw new Error('V2 signature missing');
    const { signature, ...claims } = signed;
    const valid = verify(null, Buffer.from(JSON.stringify(claims)), publicKey, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
    effectiveFeatureKeys = [];
    const closedLicense = await app.request(`/api/desktop/tenants/${A.tenantId}/license/refresh`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    const closed: unknown = await closedLicense.json();
    expect(isDeviceLicenseResponse(closed)).toBe(true);
    expect(closed).toMatchObject({ tenantId: A.tenantId, featureKeys: [] });
    if (!closed || typeof closed !== 'object' || !('signature' in closed) || typeof closed.signature !== 'string') throw new Error('closed V2 signature missing');
    const { signature: closedSignature, ...closedClaims } = closed;
    expect(verify(null, Buffer.from(JSON.stringify(closedClaims)), publicKey, Buffer.from(closedSignature, 'base64url'))).toBe(true);
    effectiveFeatureKeys = ['feat_kds'];
    const reopenedLicense = await app.request(`/api/desktop/tenants/${A.tenantId}/license/refresh`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(await reopenedLicense.json()).toMatchObject({ tenantId: A.tenantId, featureKeys: ['feat_kds'] });
    expect(await deviceLicenses.standingForTenant(ownerId, A.tenantId, DEVICE)).toBe('active');
    const stored = await db.account.collection('desktop_device_license').findOne({
      user_id: ownerId, tenant_id: A.tenantId, device_id: DEVICE,
    });
    expect(stored).toMatchObject({
      license_version: 2, valid_until: '2027-11-07T00:00:00Z',
      paid_until: '2027-11-07T00:00:00Z',
    });
    expect(typeof stored?.offline_until).toBe('string');
    expect(Date.parse(String(stored?.offline_until))).toBeLessThanOrEqual(Date.parse(String(stored?.paid_until)));
    const wrongTenantLicense = await app.request(`/api/desktop/tenants/${B.tenantId}/license/refresh`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(wrongTenantLicense.status).toBe(403);
    revokeUnavailable = true;
    const delayedRevoke = await app.request(`/api/desktop/tenants/${A.tenantId}/devices/${DEVICE}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(delayedRevoke.status).toBe(503);
    expect(await deviceLicenses.standingForTenant(ownerId, A.tenantId, DEVICE)).toBe('revoked');
    revokeUnavailable = false;
    const revoked = await app.request(`/api/desktop/tenants/${A.tenantId}/devices/${DEVICE}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(await revoked.json()).toMatchObject({ tenantId: A.tenantId, status: 'revoked', version: 2 });
    expect(await deviceLicenses.standingForTenant(ownerId, A.tenantId, DEVICE)).toBe('revoked');
    const afterRevoke = await app.request(`/api/desktop/tenants/${A.tenantId}/license/refresh`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': DEVICE } });
    expect(afterRevoke.status).toBe(403);
  });
});
