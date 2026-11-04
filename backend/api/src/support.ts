
import type { Context, Hono } from 'hono';
import type { Auth } from './lib/auth.js';

const ticketId = /^sup_[0-9A-HJKMNP-TV-Z]{26}$/;
const requestId = /^[a-f0-9-]{36}$/i;

export interface SupportConfig {
  origin: string;
  token: string;
}

export function mountSupport(app: Hono, auth: Auth, allowedOrigins: string[], config?: SupportConfig) {
  async function proxy(context: Context, ticket?: string) {
    context.header('Cache-Control', 'no-store');
    if (!config) return context.json({ message: 'Destek bağlantısı şu anda kapalı.' }, 503);
    const writing = context.req.method === 'POST';
    if (writing && !allowedOrigins.includes(context.req.header('origin') ?? '')) {
      return context.json({ message: 'Bu istek kabul edilmedi.' }, 403);
    }
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ message: 'Destek için giriş yapın.' }, 401);
    if (!session.user.emailVerified) return context.json({ message: 'Önce e-postanızı doğrulayın.' }, 403);
    if (ticket && !ticketId.test(ticket)) return context.json({ message: 'Talep bulunamadı.' }, 404);

    const headers = new Headers({ Authorization: `Bearer ${config.token}`, 'X-Support-Account': session.user.id });
    let body: string | undefined;
    if (writing) {
      const key = context.req.header('idempotency-key') ?? '';
      if (!requestId.test(key)) return context.json({ message: 'İstek kimliği geçersiz.' }, 400);
      let raw: unknown;
      try {
        raw = await context.req.json();
      } catch {
        return context.json({ message: 'Mesaj okunamadı.' }, 400);
      }
      if (!raw || typeof raw !== 'object' || !('body' in raw) || typeof raw.body !== 'string' ||
          !raw.body.trim() || [...raw.body].length > 4000) {
        return context.json({ message: 'Mesaj 1–4000 karakter olmalı.' }, 422);
      }
      if (!ticket && (!('title' in raw) || typeof raw.title !== 'string' || !raw.title.trim() ||
          [...raw.title].length > 120)) {
        return context.json({ message: 'Konu 1–120 karakter olmalı.' }, 422);
      }
      body = JSON.stringify(ticket ? { body: raw.body } :
        { body: raw.body, title: 'title' in raw ? raw.title : '', email: session.user.email });
      headers.set('Content-Type', 'application/json');
      headers.set('Idempotency-Key', `${session.user.id}:${key}`);
    }

    try {
      const path = '/api/v1/urunler/kasam360/destek' + (ticket ? `/${ticket}` : '');
      const response = await fetch(new URL(path, config.origin), {
        method: context.req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(7000),
      });
      if (response.ok) return context.json(await response.json(), response.status === 201 ? 201 : 200);
      if (response.status === 404) return context.json({ message: 'Talep bulunamadı.' }, 404);
      if (response.status === 409) return context.json({ message: 'Talep kapalı veya istek daha önce kullanılmış.' }, 409);
      if (response.status === 403) return context.json({ message: 'Bu işlem için destek erişimi kapalı.' }, 403);
      return context.json({ message: 'Destek işlemi tamamlanamadı.' }, 502);
    } catch {
      return context.json({ message: 'Destek sunucusuna ulaşılamadı.' }, 502);
    }
  }

  app.on(['GET', 'POST'], '/api/support', (context) => proxy(context));
  app.on(['GET', 'POST'], '/api/support/:ticket', (context) => proxy(context, context.req.param('ticket')));
}
