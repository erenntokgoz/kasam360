import { generateKeyPairSync, verify } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import type { Auth } from './lib/auth.js';
import { mountLicense, signingKey } from './license.js';

const labs = { origin: 'http://127.0.0.1:3600', token: 'server-token' };
const user = { id: 'usr_example', email: 'owner@example.test', emailVerified: true };
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = signingKey(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));

afterEach(() => vi.unstubAllGlobals());

function appFor(account?: typeof user) {
  const app = new Hono();
  const auth = { api: { getSession: async () => account ? { user: account } : null } } as unknown as Auth;
  mountLicense(app, auth, labs, key);
  return app;
}

it('signs only the session account and the date the admin panel returned', async () => {
  const upstream = vi.fn(async () => Response.json({
    valid_until: '2027-01-31', blocked: false,
    package: { name: 'Temel', features: ['feat_kds'], device_limit: 2 },
  }));
  vi.stubGlobal('fetch', upstream);
  expect((await appFor().request('/api/license')).status).toBe(401);
  expect((await appFor({ ...user, emailVerified: false }).request('/api/license')).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();

  const response = await appFor(user).request('/api/license?email=attacker@example.test');
  expect(response.status).toBe(200);
  const sent = upstream.mock.calls as unknown as [URL, RequestInit][];
  expect(String(sent[0][0])).toBe('http://127.0.0.1:3600/api/v1/urunler/kasam360/lisans');
  expect(sent[0][1].body).toBe(JSON.stringify({ email: user.email }));

  const { token } = await response.json() as { token: string };
  const [body, signature] = token.split('.');
  expect(verify(null, Buffer.from(body), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  expect(claims).toMatchObject({ sub: user.id, email: user.email, validUntil: '2027-01-31', blocked: false, graceHours: 72,
    plan: { name: 'Temel', features: ['feat_kds'], deviceLimit: 2 },
  });
  // Gövdedeki tek bayt değişse imza tutmaz.
  const forged = Buffer.from(JSON.stringify({ ...claims, validUntil: '2099-01-01' })).toString('base64url');
  expect(verify(null, Buffer.from(forged), publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
});

it('issues nothing when the admin panel is unreachable or answers malformed data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect((await appFor(user).request('/api/license')).status).toBe(502);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ valid_until: 'yarın', blocked: false })));
  expect((await appFor(user).request('/api/license')).status).toBe(502);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    valid_until: null, blocked: false, package: { name: 'Temel', features: ['../x'], device_limit: 2 },
  })));
  expect((await appFor(user).request('/api/license')).status).toBe(502);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
  expect((await appFor(user).request('/api/license')).status).toBe(502);
});

it('rejects a signing key that is not Ed25519', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  expect(() => signingKey(rsa.export({ format: 'der', type: 'pkcs8' }).toString('base64'))).toThrow();
});

it('treats a missing package as no features, never as all features', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ valid_until: '2027-01-31', blocked: false })));
  const { claims } = await (await appFor(user).request('/api/license')).json() as { claims: { plan: unknown } };
  expect(claims.plan).toBeNull();
});
