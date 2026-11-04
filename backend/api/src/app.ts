import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './lib/auth.js';

const LINK_CODE = /^[0-9a-f-]{36}$/;
const LINK_TTL_MS = 5 * 60 * 1000;
const LINK_LIMIT = 1000;

interface DesktopLink {
  account: { name: string; email: string; businessName?: string | null; phone?: string | null };
  expiresAt: number;
}

// Lisans ve ödeme bildirimleri de bu servise eklenecek; site yalnız bu API üzerinden konuşur.
const page = (message: string) =>
  `<!doctype html><html lang="tr"><meta charset="utf-8"><title>KASAM360</title><body style="font:18px system-ui;padding:3rem;background:#fbf0b2;color:#1e2a66">${message}</body></html>`;

export function createApp(auth: Auth, allowedOrigins: string[], siteUrl: string) {
  const app = new Hono();
  // shortcut: bekleyen bağlantılar bellektedir, ikinci sunucu eklenince veritabanına taşınmalı.
  const desktopLinks = new Map<string, DesktopLink>();

  app.get('/health', (context) => context.json({ ok: true }));
  // Masaüstü penceresi site kaynağından değildir; izinli kaynaklar dışında tarayıcı yanıtı okuyamaz.
  app.use('/api/auth/*', cors({ origin: allowedOrigins }));
  app.use('/api/desktop-link/*', cors({ origin: allowedOrigins }));

  // Masaüstü tarayıcıyı buraya açar; durum çerezi tarayıcıda kalsın diye Google adresini sunucu üretir.
  app.get('/api/desktop-link/:code/google', async (context) => {
    const code = context.req.param('code');
    if (!LINK_CODE.test(code)) return context.text('Bağlantı geçersiz.', 400);
    const started = await auth.handler(
      new Request(`${siteUrl}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: siteUrl },
        body: JSON.stringify({ provider: 'google', callbackURL: `/api/desktop-link/${code}/finish`, errorCallbackURL: '/giris' }),
      }),
    );
    const { url } = (await started.json()) as { url?: string };
    if (!url) return context.text('Google ile giriş şu anda kapalı.', 503);
    for (const cookie of started.headers.getSetCookie()) context.header('set-cookie', cookie, { append: true });
    return context.redirect(url);
  });

  // Yalnız ad ve iletişim bilgisi geçer, oturum anahtarı geçmez; kod uygulamada üretilir ve tek kullanımlıktır.
  app.get('/api/desktop-link/:code/finish', async (context) => {
    const code = context.req.param('code');
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!LINK_CODE.test(code) || !session) return context.html(page('Google girişi tamamlanamadı. Uygulamadan yeniden deneyin.'), 400);
    if (desktopLinks.size >= LINK_LIMIT) desktopLinks.clear();
    const { name, email, businessName, phone } = session.user as DesktopLink['account'];
    desktopLinks.set(code, { account: { name, email, businessName, phone }, expiresAt: Date.now() + LINK_TTL_MS });
    return context.html(page('Giriş tamam. KASAM360 uygulamasına dönebilirsiniz.'));
  });

  app.get('/api/desktop-link/:code', (context) => {
    const code = context.req.param('code');
    const link = desktopLinks.get(code);
    if (!link) return context.body(null, 204);
    desktopLinks.delete(code);
    return link.expiresAt < Date.now() ? context.body(null, 204) : context.json(link.account);
  });

  app.on(['GET', 'POST'], '/api/auth/*', (context) => {
    // Hesap kütüphanesi çerezsiz isteklerde kaynağı denetlemez; başka siteden kayıt ve mail tetiklenemesin.
    const origin = context.req.header('origin');
    if (context.req.method === 'POST' && (!origin || !allowedOrigins.includes(origin))) {
      return context.json({ message: 'Bu istek kabul edilmedi.' }, 403);
    }
    return auth.handler(context.req.raw);
  });

  return app;
}
