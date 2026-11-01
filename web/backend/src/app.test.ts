import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { validateLead } from './lib/lead.js';
import { createRateLimiter } from './lib/rateLimiter.js';

const ORIGIN = 'https://kasam360.com.tr';

const valid = {
  name: 'Ayşe Yılmaz',
  business: 'Liman Lokantası',
  email: 'ayse@example.com',
  phone: '',
  message: '',
  consent: true,
  website: '',
};

function post(app: ReturnType<typeof createApp>, body: unknown, origin: string | null = ORIGIN, ip = '1.1.1.1') {
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (origin) headers.origin = origin;
  return app.request('/lead', { method: 'POST', headers, body: JSON.stringify(body) });
}

function buildApp(result: 'sent' | 'not_configured' | 'failed' = 'sent') {
  const sendMail = vi.fn().mockResolvedValue(result);
  const app = createApp({ allowedOrigins: [ORIGIN], contactEmail: 'iletisim@example.com', sendMail });
  return { app, sendMail };
}

describe('validateLead', () => {
  it('geçerli talebi kabul eder', () => {
    expect(validateLead(valid)).toMatchObject({ ok: true, isBot: false });
  });

  it('metin onayını gerçek onay saymaz', () => {
    expect(validateLead({ ...valid, consent: 'true' }).ok).toBe(false);
  });

  it('e-posta başlığına satır sonu sızdırmaz', () => {
    expect(validateLead({ ...valid, business: 'Kafe\nBcc: x@example.com' }).ok).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('sınırı aşan isteği durdurur, süre dolunca açar', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 10)).toBe(true);
    expect(limiter.allow('a', 20)).toBe(false);
    expect(limiter.allow('a', 1500)).toBe(true);
  });
});

describe('POST /lead', () => {
  it('geçerli talebi iletir', async () => {
    const { app, sendMail } = buildApp();
    const response = await post(app, valid);
    expect(response.status).toBe(200);
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it('izinsiz kaynağı ve kaynaksız isteği reddeder', async () => {
    const { app, sendMail } = buildApp();
    expect((await post(app, valid, 'https://baska.example')).status).toBe(403);
    expect((await post(app, valid, null)).status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('e-posta servisi yoksa başarı dönmez', async () => {
    const { app } = buildApp('not_configured');
    expect((await post(app, valid)).status).toBe(503);
  });

  it('botu göndermeden başarıyla geçiştirir', async () => {
    const { app, sendMail } = buildApp();
    const response = await post(app, { ...valid, website: 'spam.example' });
    expect(response.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('hatalı formda alan hatalarını döner', async () => {
    const { app } = buildApp();
    const response = await post(app, { ...valid, email: 'x', consent: false });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: { email: expect.any(String), consent: expect.any(String) } });
  });

  it('sınırı aşan istemciyi durdurur', async () => {
    const { app } = buildApp();
    for (let attempt = 0; attempt < 5; attempt += 1) await post(app, valid);
    expect((await post(app, valid)).status).toBe(429);
    expect((await post(app, valid, ORIGIN, '2.2.2.2')).status).toBe(200);
  });
});
