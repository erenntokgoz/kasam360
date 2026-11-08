
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
    <div className="k-stack">
      {error && <p className="k-alert" role="alert">{error}</p>}
      {login && <div className="k-row"><Link href="/giris" className="k-btn k-btn-ink k-btn-lg">Giriş yap</Link></div>}
      {!ready && !error && <p className="k-muted" role="status">Talepleriniz yükleniyor…</p>}
      {ready && (
        <div className="k-support">
          <section className="k-stack" aria-labelledby="support-tickets">
            <h2 id="support-tickets" className="k-section-title" style={{ margin: 0 }}>Taleplerim</h2>
            <div className="k-tickets">
              {tickets.length === 0 && <p className="k-empty">Henüz destek talebi yok.</p>}
              {tickets.map((ticket) => {
                const closed = thread?.id === ticket.id ? thread.closed : ticket.closed;
                return (
                  <button type="button" key={ticket.id} aria-pressed={selected === ticket.id} disabled={busy}
                    onClick={() => { if (selected !== ticket.id) { setThread(undefined); setError(''); setSelected(ticket.id); } }}>
                    <span>{ticket.title}</span>
                    <span className="k-tag" data-open={!closed}>{closed ? 'Kapalı' : 'Açık'}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="k-stack">
            {thread && (
              <article className="k-thread" aria-label={thread.title}>
                <h2 className="k-section-title" style={{ margin: 0 }}>{thread.title}</h2>
                <div className="k-msg"><strong>Siz</strong><p>{thread.body}</p></div>
                {thread.messages.map((message) => (
                  <div key={message.id} className="k-msg" data-staff={message.source === 'staff'}>
                    <strong>{message.source === 'staff' ? 'Destek' : 'Siz'}</strong>
                    <p>{message.body}</p>
                  </div>
                ))}
                {!thread.closed && <form className="k-stack" onSubmit={(event) => void submit(event, thread.id)}>
                  <div className="k-field"><label htmlFor="reply-body">Yanıtınız</label><textarea id="reply-body" className="k-input" name="body" required maxLength={4000} rows={3} /></div>
                  <div className="k-row"><button className="k-btn k-btn-ink" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button></div>
                </form>}
              </article>
            )}
            <form className="k-panel k-stack" onSubmit={(event) => void submit(event)}>
              <h2 className="k-section-title" style={{ margin: 0 }}>Yeni talep</h2>
              <div className="k-field"><label htmlFor="ticket-title">Konu</label><input id="ticket-title" className="k-input" name="title" required maxLength={120} /></div>
              <div className="k-field"><label htmlFor="ticket-body">Mesaj</label><textarea id="ticket-body" className="k-input" name="body" required maxLength={4000} rows={4} /></div>
              <div className="k-row"><button className="k-btn k-btn-ink" disabled={busy}>{busy ? 'Gönderiliyor…' : 'Talep aç'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
