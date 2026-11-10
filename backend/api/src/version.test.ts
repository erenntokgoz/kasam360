import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountVersion, readVersion } from './version.js';

describe('/version', () => {
  it('build argümanlarından gelen commit ve zamanı döndürür', async () => {
    const app = new Hono();
    mountVersion(app, { GIT_SHA: 'a'.repeat(40), BUILD_TIME: '2026-11-10T10:00:00Z' });
    const response = await app.request('/version');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commit: 'a'.repeat(40), builtAt: '2026-11-10T10:00:00Z' });
  });

  it('değer yoksa unknown döner', () => {
    expect(readVersion({})).toEqual({ commit: 'unknown', builtAt: 'unknown' });
  });
});
