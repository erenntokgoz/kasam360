import { Hono, type Context } from 'hono';
import { validateLead, type Lead } from './lib/lead.js';
import { createRateLimiter } from './lib/rateLimiter.js';
import type { SendResult } from './lib/sendLeadMail.js';

const MAX_BODY_CHARS = 8000;
const LEAD_LIMIT = 5;
const LEAD_WINDOW_MS = 10 * 60 * 1000;

interface AppOptions {
  allowedOrigins: string[];
  contactEmail: string;
  sendMail: (lead: Lead) => Promise<SendResult>;
}

function clientKey(context: Context): string {
  return context.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Lisans, hesap ve ödeme bildirimleri de bu servise eklenecek; site yalnız bu API üzerinden konuşur.
export function createApp({ allowedOrigins, contactEmail, sendMail }: AppOptions) {
  const app = new Hono();
  const limiter = createRateLimiter(LEAD_LIMIT, LEAD_WINDOW_MS);

  app.get('/health', (context) => context.json({ ok: true }));

  app.post('/lead', async (context) => {
    // Form yalnız kendi sitemizden gönderilebilsin; liste boşsa istek reddedilir.
    const origin = context.req.header('origin');
    if (!origin || !allowedOrigins.includes(origin)) {
      return context.json({ error: 'Bu istek kabul edilmedi.' }, 403);
    }
    if (!limiter.allow(clientKey(context))) {
      return context.json({ error: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.' }, 429);
    }

    const raw = await context.req.text();
    if (raw.length > MAX_BODY_CHARS) return context.json({ error: 'Form çok uzun.' }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return context.json({ error: 'Form okunamadı. Sayfayı yenileyip tekrar deneyin.' }, 400);
    }

    const result = validateLead(body);
    if (!result.ok) return context.json({ errors: result.errors }, 422);
    // Tuzak alanı dolduran bot başarı görür; böylece filtreyi öğrenip aşamaz.
    if (result.isBot) return context.json({ ok: true });

    const sent = await sendMail(result.lead);
    if (sent !== 'sent') {
      return context.json({ error: `Talep iletilemedi. ${contactEmail} adresine yazın.` }, 503);
    }
    return context.json({ ok: true });
  });

  return app;
}
