
'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

type Ticket = { id: string; title: string; closed: boolean };
type Thread = Ticket & { body: string; messages: { id: string; source: string; body: string }[] };

class SupportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/support' + path, { cache: 'no-store', ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new SupportError(response.status, result?.message ?? 'Destek isteği tamamlanamadı.');
  return result as T;
}

export function SupportPanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState('');
  const [thread, setThread] = useState<Thread>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ payload: string; key: string } | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    request<Ticket[]>('', { signal: controller.signal }).then((rows) => {
      setTickets(rows);
      setReady(true);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLogin(error instanceof SupportError && error.status === 401);
      setError(error instanceof Error ? error.message : 'Destek açılamadı.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        const data = await request<Thread>(`/${selected}`, { signal: controller.signal });
        if (!controller.signal.aborted) setThread(data);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Talep açılamadı.');
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [selected]);

  async function submit(event: FormEvent<HTMLFormElement>, ticket = '') {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = String(fields.get('body') ?? '');
    const data = JSON.stringify(ticket ? { body } : { body, title: String(fields.get('title') ?? '') });
    const path = ticket ? `/${ticket}` : '';
    const payload = path + data;
    if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>(path, {
        method: 'POST', body: data,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
      });
      pending.current = undefined;
      form.reset();
      if (ticket) {
        setThread(await request<Thread>(path));
      } else {
        setTickets((rows) => [{ id: result.id, title: String(fields.get('title')), closed: false }, ...rows.filter((row) => row.id !== result.id)]);
        setThread(undefined);
        setSelected(result.id);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Mesaj gönderilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      {error && <p role="alert">{error}</p>}
      {login && <Link href="/giris" className="btn">Giriş Yap</Link>}
      {ready && (
        <>
          <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
            <h2 className="text-xl font-bold">Yeni Talep</h2>
            <label className="grid gap-1">Konu<input className="border p-2" name="title" required maxLength={120} /></label>
            <label className="grid gap-1">Mesaj<textarea className="border p-2" name="body" required maxLength={4000} rows={4} /></label>
            <button className="btn justify-self-start" disabled={busy}>Talep Aç</button>
          </form>
          <section className="grid gap-3" aria-labelledby="support-tickets">
            <h2 id="support-tickets" className="text-xl font-bold">Taleplerim</h2>
            {tickets.length === 0 && <p>Henüz destek talebi yok.</p>}
            {tickets.map((ticket) => (
              <button type="button" key={ticket.id} className="form-row text-left" aria-pressed={selected === ticket.id} disabled={busy}
                onClick={() => { if (selected !== ticket.id) { setThread(undefined); setError(''); setSelected(ticket.id); } }}>
                {ticket.title} · {(thread?.id === ticket.id ? thread.closed : ticket.closed) ? 'Kapalı' : 'Açık'}
              </button>
            ))}
            {thread && (
              <article className="grid gap-3" aria-label={thread.title}>
                <p className="whitespace-pre-wrap break-words">{thread.body}</p>
                {thread.messages.map((message) => (
                  <div key={message.id} className="border-t pt-2">
                    <strong>{message.source === 'staff' ? 'Destek' : 'Siz'}</strong>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                ))}
                {!thread.closed && <form className="grid gap-2" onSubmit={(event) => void submit(event, thread.id)}>
                  <label className="grid gap-1">Yanıt<textarea className="border p-2" name="body" required maxLength={4000} rows={3} /></label>
                  <button className="btn justify-self-start" disabled={busy}>Gönder</button>
                </form>}
              </article>
            )}
          </section>
        </>
      )}
    </div>
  );
}
