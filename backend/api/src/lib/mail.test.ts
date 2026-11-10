import { afterEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMailer, MAIL_CONTRACT } from './mail.js';

// Gerçek Mailu'ya bağlanılmaz: yerel sahte SMTP sunucusu AUTH PLAIN/LOGIN ve DATA'yı kaydeder.
interface FakeServer { port: number; messages: string[]; authAttempts: number; connections: number; close(): Promise<void> }

async function fakeSmtp(user: string, pass: string): Promise<FakeServer> {
  const state: FakeServer = { port: 0, messages: [], authAttempts: 0, connections: 0, close: async () => {} };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    state.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    let mode: 'cmd' | 'data' | 'login-user' | 'login-pass' = 'cmd';
    let loginUser = '';
    let data = '';
    const send = (line: string) => socket.write(`${line}\r\n`);
    const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8');
    send('220 fake ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (mode === 'data') {
          if (line === '.') { state.messages.push(data); data = ''; mode = 'cmd'; send('250 queued'); } else data += `${line}\n`;
        } else if (mode === 'login-user') {
          loginUser = decode(line); mode = 'login-pass'; send('334 UGFzc3dvcmQ6');
        } else if (mode === 'login-pass') {
          mode = 'cmd';
          if (loginUser === user && decode(line) === pass) send('235 ok'); else send('535 5.7.8 rejected');
        } else {
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) { send('250-fake'); send('250 AUTH PLAIN LOGIN'); }
          else if (upper.startsWith('AUTH PLAIN')) {
            state.authAttempts += 1;
            send(decode(line.split(' ')[2] ?? '') === `\0${user}\0${pass}` ? '235 ok' : '535 5.7.8 rejected');
          } else if (upper.startsWith('AUTH LOGIN')) { state.authAttempts += 1; mode = 'login-user'; send('334 VXNlcm5hbWU6'); }
          else if (upper.startsWith('DATA')) { mode = 'data'; send('354 go'); }
          else if (upper.startsWith('QUIT')) { send('221 bye'); socket.end(); }
          else send('250 ok');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.port = (server.address() as net.AddressInfo).port;
  state.close = () => new Promise<void>((resolve) => { sockets.forEach((s) => s.destroy()); server.close(() => resolve()); });
  return state;
}

const mail = { to: 'musteri@example.test', subject: 'Doğrulama', text: 'Bağlantı: https://example.test/x' };
const ORIGIN = 'https://labs.example.test';
const labsEnv = { LABS_CATALOG_ORIGIN: ORIGIN, LABS_CATALOG_TOKEN: 'labs_test' } as NodeJS.ProcessEnv;

const labsBody = (port: number, overrides: Record<string, unknown> = {}) => ({
  contract: MAIL_CONTRACT, accountId: 'smt_01TEST', source: 'product', host: '127.0.0.1', port,
  security: 'none', username: 'noreply@example.test', password: 'dogru-parola',
  fromName: 'KASAM360', fromAddress: 'noreply@example.test', ...overrides,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const servers: FakeServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => s.close()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
async function smtp(user = 'noreply@example.test', pass = 'dogru-parola') { const s = await fakeSmtp(user, pass); servers.push(s); return s; }

describe('Labs atanmış SMTP hesabıyla gönderim', () => {
  it('Labs hesabından gönderir, gönderen adı/adresi ve kimlik doğrulama kullanılır', async () => {
    const server = await smtp();
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => json(200, labsBody(server.port)));
    const send = createMailer({ env: labsEnv, fetcher, retryDelayMs: 0 });
    await send(mail);
    expect(server.authAttempts).toBe(1);
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain('From: KASAM360 <noreply@example.test>');
    expect(server.messages[0]).toContain('To: musteri@example.test');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(`${ORIGIN}/api/v1/urunler/kasam360/posta-hesabi`);
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer labs_test');
  });

  it('Labs ayarı env yedeğinden önceliklidir', async () => {
    const labs = await smtp();
    const backup = await smtp('yedek', 'yedek');
    const env = { ...labsEnv, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(backup.port), SMTP_USERNAME: 'yedek', SMTP_PASSWORD: 'yedek', SMTP_FROM: 'yedek@example.test' } as NodeJS.ProcessEnv;
    await createMailer({ env, fetcher: async () => json(200, labsBody(labs.port)), retryDelayMs: 0 })(mail);
    expect(labs.messages).toHaveLength(1);
    expect(backup.connections).toBe(0);
  });

  it('taze yanıt önbellekten gelir; Labs her postada çağrılmaz', async () => {
    const server = await smtp();
    const fetcher = vi.fn(async () => json(200, labsBody(server.port)));
    let clock = 1_000_000;
    const send = createMailer({ env: labsEnv, fetcher, now: () => clock, freshMs: 60_000, retryDelayMs: 0 });
    await send(mail);
    clock += 30_000;
    await send(mail);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 31_000;
    await send(mail);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(server.messages).toHaveLength(3);
  });

  it('yanlış parolada başarı dönmez ve env yedeğine kaymaz', async () => {
    const labs = await smtp('noreply@example.test', 'baska-parola');
    const backup = await smtp('yedek', 'yedek');
    const env = { ...labsEnv, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(backup.port), SMTP_USERNAME: 'yedek', SMTP_PASSWORD: 'yedek', SMTP_FROM: 'yedek@example.test' } as NodeJS.ProcessEnv;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = createMailer({ env, fetcher: async () => json(200, labsBody(labs.port)), retryDelayMs: 0 });
    await expect(send(mail)).rejects.toThrow();
    expect(labs.messages).toHaveLength(0);
    expect(backup.connections).toBe(0);
  });

  it('bozuk Labs yanıtı ve yerel olmayan şifresiz sunucu reddedilir', async () => {
    const backup = await smtp('yedek', 'yedek');
    const env = { ...labsEnv, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(backup.port), SMTP_USERNAME: 'yedek', SMTP_PASSWORD: 'yedek', SMTP_FROM: 'yedek@example.test' } as NodeJS.ProcessEnv;
    for (const body of [{ ...labsBody(1), password: '' }, { ...labsBody(1), contract: 'x' }, labsBody(1, { host: 'mail.example.test' }), { ...labsBody(1), port: 70000 }, { ...labsBody(1), fromName: 'A <b>' }]) {
      await expect(createMailer({ env, fetcher: async () => json(200, body), retryDelayMs: 0 })(mail)).rejects.toThrow();
    }
    expect(backup.connections).toBe(0);
  });
});

describe('Labs hesabı yok veya erişilemiyor', () => {
  const noAccount = async () => json(404, { contract: MAIL_CONTRACT, code: 'MAIL_ACCOUNT_NOT_CONFIGURED' });

  it('hesap yoksa ve yedek yoksa hata döner, geliştirme dizini olmadan hiçbir şey yazılmaz', async () => {
    await expect(createMailer({ env: labsEnv, fetcher: noAccount })(mail)).rejects.toThrow('SMTP ayarları eksik.');
  });

  it('üretimde DEV_MAIL_DIR olsa bile sink kapalıdır ve hata döner', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k360-mail-')); dirs.push(dir);
    const env = { ...labsEnv, DEV_MAIL_DIR: dir, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    await expect(createMailer({ env, fetcher: noAccount })(mail)).rejects.toThrow('SMTP ayarları eksik.');
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('geliştirme modunda (üretim değil, DEV_MAIL_DIR açık) sink dosyaya yazar', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k360-mail-')); dirs.push(dir);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ...labsEnv, DEV_MAIL_DIR: dir, NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    await createMailer({ env, fetcher: noAccount })(mail);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('hesap yoksa tam env SMTP_* yedeği kullanılır', async () => {
    const sendMail = vi.fn(async (..._args: unknown[]) => ({}));
    const createTransport = vi.fn((..._args: unknown[]) => ({ sendMail })) as unknown as typeof import('nodemailer').createTransport;
    const env = { ...labsEnv, SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURITY: 'ssl', SMTP_USERNAME: 'yedek', SMTP_PASSWORD: 'yedek', SMTP_FROM: 'yedek@example.test' } as NodeJS.ProcessEnv;
    await createMailer({ env, fetcher: noAccount, createTransport })(mail);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.test', port: 465, secure: true }));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('Labs erişilemezken önbelleksiz ve yedeksiz hata döner', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = async () => { throw new Error('ECONNREFUSED'); };
    await expect(createMailer({ env: labsEnv, fetcher: down })(mail)).rejects.toThrow('SMTP ayarları eksik.');
    const unauthorized = async () => json(401, {});
    await expect(createMailer({ env: labsEnv, fetcher: unauthorized })(mail)).rejects.toThrow('SMTP ayarları eksik.');
    const noSecret = async () => json(503, { code: 'MAIL_SECRET_UNAVAILABLE' });
    await expect(createMailer({ env: labsEnv, fetcher: noSecret })(mail)).rejects.toThrow('SMTP ayarları eksik.');
  });

  it('Labs erişilemezken son doğrulanmış hesap süre sınırı içinde kullanılır, sonra hata döner', async () => {
    const server = await smtp();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let up = true;
    let clock = 5_000_000;
    const fetcher = async () => { if (up) return json(200, labsBody(server.port)); throw new Error('ECONNREFUSED'); };
    const send = createMailer({ env: labsEnv, fetcher, now: () => clock, freshMs: 1000, staleMs: 600_000, retryDelayMs: 0 });
    await send(mail);
    up = false;
    clock += 10_000;
    await send(mail);
    expect(server.messages).toHaveLength(2);
    clock += 700_000;
    await expect(send(mail)).rejects.toThrow('SMTP ayarları eksik.');
    expect(server.messages).toHaveLength(2);
  });
});
