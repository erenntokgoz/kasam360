import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { reservePort, origins, serviceReady, ensureNextProject } from './devServers.mjs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Dolu port atlanır ve seçilen port başlangıca kadar tutulur', async () => {
  const busy = net.createServer(socket => socket.destroy());
  await new Promise(resolve => busy.listen(0, '127.0.0.1', resolve));
  const preferred = busy.address().port;
  const chosen = await reservePort(preferred);
  try {
    assert.ok(chosen.port > preferred);
    const probe = net.createServer();
    const error = await new Promise(resolve => {
      probe.once('error', resolve);
      probe.listen(chosen.port, '127.0.0.1', () => { probe.close(); resolve(null); });
    });
    assert.equal(error.code, 'EADDRINUSE');
  } finally { await chosen.release(); await new Promise(resolve => busy.close(resolve)); }
});

test('Tüm bağlantılar seçilen portlardan türetilir', () => {
  const result = origins({ web: 3008, api: 4009, labs: 3607, desktop: 1421 });
  assert.equal(result.web, 'http://127.0.0.1:3008');
  assert.equal(result.api, 'http://127.0.0.1:4009');
  assert.equal(result.callback, 'http://127.0.0.1:3008/api/auth/callback/google');
});

test('SMTP uyarısı yalnız eksik zorunlu alanları adlandırır', async () => {
  const { missingSmtpFields } = await import('./devServers.mjs');
  assert.equal(typeof missingSmtpFields, 'function');
  assert.deepEqual(missingSmtpFields({ SMTP_PASSWORD: 'configured' }, {}), ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_FROM']);
  assert.deepEqual(missingSmtpFields({ SMTP_HOST: 'h', SMTP_USERNAME: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'f' }, {}), []);
  assert.deepEqual(missingSmtpFields({ SMTP_PASSWORD: 'file-password' }, {
    SMTP_HOST: 'parent-host', SMTP_USERNAME: 'parent-user', SMTP_FROM: 'parent-from',
  }), []);
  assert.deepEqual(missingSmtpFields({ SMTP_HOST: '' }, {
    SMTP_HOST: 'parent-host', SMTP_USERNAME: 'parent-user', SMTP_PASSWORD: 'parent-password', SMTP_FROM: 'parent-from',
  }), ['SMTP_HOST']);
});

test('Hatalı servis diğer servislerin başlatılmasını kesmez', async () => {
  assert.equal(await serviceReady('http://127.0.0.1:1', { exitCode: 101 }, () => false), false);
});

test('Port beklerken gelen bağlantı servis başlangıcını kilitlemez', async () => {
  const held = await reservePort(41000);
  const socket = net.connect(held.port, '127.0.0.1');
  socket.on('error', () => {});
  await new Promise(resolve => socket.once('connect', resolve));
  let timeout;
  try {
    const released = await Promise.race([held.release().then(() => true), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 1000); })]);
    assert.equal(released, true);
  } finally { clearTimeout(timeout); socket.destroy(); }
});

test('Next yalıtılmış tip üretimi kaynak ağacının next-env dosyasına dokunmaz', () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), 'kasam-next-isolation-'));
  const source = path.join(testRoot, 'source');
  const state = path.join(testRoot, 'state');
  mkdirSync(source);
  mkdirSync(path.join(source, 'src'));
  mkdirSync(path.join(source, 'public'));
  mkdirSync(path.join(source, 'node_modules'));
  for (const name of ['package.json', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json']) {
    writeFileSync(path.join(source, name), name);
  }
  const originalNextEnv = '/// <reference types="next" />\n';
  writeFileSync(path.join(source, 'next-env.d.ts'), originalNextEnv);
  const project = ensureNextProject(source, path.join(state, 'web-project'));
  writeFileSync(path.join(project, 'next-env.d.ts'), 'import "./.next/types/routes.d.ts";\n');
  try {
    assert.equal(readFileSync(path.join(source, 'next-env.d.ts'), 'utf8'), originalNextEnv);
    assert.equal(readFileSync(path.join(project, 'next-env.d.ts'), 'utf8'), 'import "./.next/types/routes.d.ts";\n');
  } finally {
    const resolvedRoot = path.resolve(testRoot);
    const expectedParent = path.resolve(os.tmpdir());
    if (!resolvedRoot.startsWith(expectedParent + path.sep)) throw new Error('Test fixture cleanup path escaped temp root');
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
});
