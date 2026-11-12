import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { mountSupport, type SupportConfig } from './support.js';
import type { Auth } from './lib/auth.js';
import type { LicenseKeys } from './desktopLicense.js';
import { mountTenantMembership } from './tenantMembership.js';
import { mountTenantCommercial, type TenantCommercialConfig } from './tenantCommercial.js';
import { mountCatalog } from './catalog.js';
import type { Databases } from './lib/mongo.js';
import { mountVersion } from './version.js';

const LINK_CODE = /^[0-9a-f-]{36}$/;
const LINK_TTL_MS = 5 * 60 * 1000;
const LINK_LIMIT = 1000;

interface DesktopLink {
  account: { name: string; email: string; businessName?: string | null; phone?: string | null };
  /** Google ile bağlanan kasanın lisans anahtarı; kod tek kullanımlık olduğu için bir kez okunur. */
  licenseKey?: string;
  expiresAt: number;
}

// Lisans ve ödeme bildirimleri de bu servise eklenecek; site yalnız bu API üzerinden konuşur.
const page = (message: string) =>
  `<!doctype html><html lang="tr"><meta charset="utf-8"><title>KASAM360</title><body style="font:18px system-ui;padding:3rem;background:#fbf0b2;color:#1e2a66">${message}</body></html>`;

export function createApp(
  auth: Auth, allowedOrigins: string[], siteUrl: string, support?: SupportConfig, licenseKeys?: LicenseKeys, databases?: Databases,
  tenantCommercialConfig?: TenantCommercialConfig,
) {
  const app = new Hono();
  mountCatalog(app);
  // shortcut: bekleyen bağlantılar bellektedir, ikinci sunucu eklenince veritabanına taşınmalı.
  const desktopLinks = new Map<string, DesktopLink>();
  // Yalnız uygulamanın başlattığı kodlar tamamlanabilir: tahmin edilen ya da dışarıdan uydurulan
  // bir kodla bekleyen bağlantı oluşturulamaz. Kod bitişte tüketilir (tek kullanımlık).
  const startedLinks = new Map<string, number>();

  app.get('/health', (context) => context.json({ ok: true }));
  mountVersion(app);
  if (databases) {
    mountTenantMembership(app, auth, databases.accountClient, databases.account);
    mountTenantCommercial(app, auth, databases.account, tenantCommercialConfig);
  }
  // Masaüstü penceresi site kaynağından değildir; izinli kaynaklar dışında tarayıcı yanıtı okuyamaz.
  app.use('/api/auth/*', cors({ origin: allowedOrigins }));
  app.use('/api/desktop-link/*', cors({ origin: allowedOrigins }));

  // Masaüstü tarayıcıyı buraya açar; durum çerezi tarayıcıda kalsın diye Google adresini sunucu üretir.
  app.get('/api/desktop-link/:code/google', async (context) => {
    const code = context.req.param('code');
    if (!LINK_CODE.test(code)) return context.text('Bağlantı geçersiz.', 400);
    if (startedLinks.size >= LINK_LIMIT) startedLinks.clear();
    startedLinks.set(code, Date.now() + LINK_TTL_MS);
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
    const startedUntil = startedLinks.get(code);
    startedLinks.delete(code);
    if (!LINK_CODE.test(code) || !session || startedUntil === undefined || startedUntil < Date.now()) {
      return context.html(page('Google girişi tamamlanamadı. Uygulamadan yeniden deneyin.'), 400);
    }
    if (desktopLinks.size >= LINK_LIMIT) desktopLinks.clear();
    const { name, email, businessName, phone } = session.user as DesktopLink['account'];
    const licenseKey = licenseKeys && session.user.emailVerified
      ? await licenseKeys.create(session.user.id).catch(() => undefined) : undefined;
    desktopLinks.set(code, { account: { name, email, businessName, phone }, licenseKey, expiresAt: Date.now() + LINK_TTL_MS });
    // Uygulama penceresi ya da Android sekmesi bu adresi yakalayıp kendini kapatır; sistem tarayıcısında
    // özel şema sessizce yok sayılır ve metin kalır.
    return context.html(page('Giriş tamam. KASAM360 uygulamasına dönebilirsiniz.<script>setTimeout(function(){location.href="kasam360://google-done"},400)</script>'));
  });

  app.get('/api/desktop-link/:code', (context) => {
    const code = context.req.param('code');
    const link = desktopLinks.get(code);
    if (!link) return context.body(null, 204);
    desktopLinks.delete(code);
    return link.expiresAt < Date.now()
      ? context.body(null, 204) : context.json({ ...link.account, licenseKey: link.licenseKey });
  });

  app.on(['GET', 'POST'], '/api/auth/*', (context) => {
    // Hesap kütüphanesi çerezsiz isteklerde kaynağı denetlemez; başka siteden kayıt ve mail tetiklenemesin.
    const origin = context.req.header('origin');
    if (context.req.method === 'POST' && (!origin || !allowedOrigins.includes(origin))) {
      return context.json({ message: 'Bu istek kabul edilmedi.' }, 403);
    }
    return auth.handler(context.req.raw);
  });

  const supportLimit = bodyLimit({ maxSize: 24 * 1024 });
  app.use('/api/support', supportLimit);
  app.use('/api/support/*', supportLimit);
  mountSupport(app, auth, allowedOrigins, support);
  return app;
}
