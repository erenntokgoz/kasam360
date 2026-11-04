
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import type { Auth } from './lib/auth.js';
import { mountSupport } from './support.js';

const origin = 'https://kasam360.com.tr';
const config = { origin: 'http://127.0.0.1:3600', token: 'server-token' };
const user = { id: 'usr_example', email: 'owner@example.test', emailVerified: true };

afterEach(() => vi.unstubAllGlobals());

function appFor(account?: typeof user) {
  const app = new Hono();
  const auth = { api: { getSession: async () => account ? { user: account } : null } } as unknown as Auth;
  mountSupport(app, auth, [origin], config);
  return app;
}

it('uses only verified session identity and rejects an alien origin', async () => {
  const upstream = vi.fn(async () => Response.json({ id: 'sup_example' }, { status: 201 }));
  vi.stubGlobal('fetch', upstream);
  const request = (site: string) => ({
    method: 'POST',
    headers: { origin: site, 'content-type': 'application/json', 'idempotency-key': '11111111-2222-3333-4444-555555555555', 'x-support-account': 'attacker' },
    body: JSON.stringify({ title: 'Yardım', body: 'Mesaj', email: 'attacker@example.test' }),
  });
  expect((await appFor(user).request('/api/support', request('https://example.test'))).status).toBe(403);
  expect((await appFor().request('/api/support', request(origin))).status).toBe(401);
  expect((await appFor({ ...user, emailVerified: false }).request('/api/support', request(origin))).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
  expect((await appFor(user).request('/api/support', request(origin))).status).toBe(201);
  expect(upstream).toHaveBeenCalledWith(new URL('/api/v1/urunler/kasam360/destek', config.origin), expect.objectContaining({
    headers: expect.any(Headers), body: JSON.stringify({ body: 'Mesaj', title: 'Yardım', email: user.email }),
  }));
  const sent = upstream.mock.calls as unknown as [URL, RequestInit][];
  expect(new Headers(sent[0][1].headers).get('x-support-account')).toBe(user.id);
});
