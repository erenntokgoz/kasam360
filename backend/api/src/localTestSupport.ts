import type { Hono } from 'hono';
import { ulid } from './lib/prefixedId.js';

interface Ticket { id: string; title: string; body: string; closed: boolean; messages: { id: string; source: string; body: string }[] }
const TEST_ACCOUNTS = new Set(['usr_01arz3ndektsv4rrffq69g5fav', 'usr_01arz3ndektsv4rrffq69g5faw']);

// Adapter yalnız loopback'te kullanılır; destek talepleri bellek içindedir ve dışarı gönderilmez.
export function mountLocalTestSupport(app: Hono, token: string) {
  const tickets = new Map<string, Map<string, Ticket>>();
  const validToken = token === 'local-test-support' && process.env.LOCAL_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
  const account = (context: { req: { header(name: string): string | undefined } }) => {
    if (!validToken || context.req.header('authorization') !== `Bearer ${token}`) return null;
    const account = context.req.header('x-support-account') ?? '';
    return TEST_ACCOUNTS.has(account) ? account : null;
  };

  app.get('/api/v1/urunler/kasam360/destek', async (context) => {
    const userId = account(context);
    if (!userId) return context.json({ message: 'Erişim reddedildi.' }, 403);
    return context.json([...(tickets.get(userId)?.values() ?? [])].map(({ id, title, closed }) => ({ id, title, closed })));
  });

  app.get('/api/v1/urunler/kasam360/destek/:ticket', async (context) => {
    const userId = account(context);
    if (!userId) return context.json({ message: 'Erişim reddedildi.' }, 403);
    const ticket = tickets.get(userId)?.get(context.req.param('ticket'));
    return ticket ? context.json(ticket) : context.json({ message: 'Talep bulunamadı.' }, 404);
  });

  app.post('/api/v1/urunler/kasam360/destek', async (context) => {
    const userId = account(context);
    if (!userId) return context.json({ message: 'Erişim reddedildi.' }, 403);
    const body = await context.req.json<{ title?: string; body?: string }>().catch(() => ({} as { title?: string; body?: string }));
    if (!body.title?.trim() || !body.body?.trim()) return context.json({ message: 'Konu ve mesaj gerekli.' }, 422);
    const userTickets = tickets.get(userId) ?? new Map<string, Ticket>();
    tickets.set(userId, userTickets);
    const id = `sup_${ulid().toUpperCase()}`;
    const ticket: Ticket = { id, title: body.title.trim(), body: body.body.trim(), closed: false, messages: [] };
    userTickets.set(id, ticket);
    return context.json({ id }, 201);
  });

  app.post('/api/v1/urunler/kasam360/destek/:ticket', async (context) => {
    const userId = account(context);
    if (!userId) return context.json({ message: 'Erişim reddedildi.' }, 403);
    const ticket = tickets.get(userId)?.get(context.req.param('ticket'));
    if (!ticket) return context.json({ message: 'Talep bulunamadı.' }, 404);
    if (ticket.closed) return context.json({ message: 'Talep kapalı.' }, 409);
    const body = await context.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
    if (!body.body?.trim()) return context.json({ message: 'Mesaj gerekli.' }, 422);
    ticket.messages.push({ id: `msg_${ticket.messages.length + 1}`, source: 'customer', body: body.body.trim() });
    return context.json(ticket);
  });
}
