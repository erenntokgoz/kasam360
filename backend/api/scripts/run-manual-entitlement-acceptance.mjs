import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const labs = path.resolve(root, '../360labs');
// Her koşu kendi geçici Labs verisini açar; önceki koşunun rastgele admin parolası yeni girişi engellemez.
const labsData = mkdtempSync(path.join(os.tmpdir(), 'kasam-manual-entitlement-'));
const labsTarget = path.join(labs, '.manual-entitlement-target');
const api = path.join(root, 'backend/api');
const backend = path.join(root, 'backend');
const labsToken = 'labs_0000000000000000000000000000000000000000000000000000000000000000';

function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('dynamic port unavailable'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function launch(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function ready(url, child, label) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} stopped before becoming ready`);
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${label} readiness timed out`);
}

function stop(child) { if (child && child.exitCode === null) child.kill('SIGTERM'); }

const labsPort = await port();
const apiPort = await port();
const labsOrigin = `http://127.0.0.1:${labsPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const publicKeyHex = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const adminPassword = `Local-${randomUUID()}-Aa9!`;
let labsProcess;
let apiProcess;

async function applyFeatureOverride(cookie, value) {
  const now = new Date(Date.now() - 60_000).toISOString();
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const form = new URLSearchParams({
    adjustment_type: 'feature', feature_code: 'feat_kds', feature_enabled: value,
    starts_at: now, expires_at: expiry, reason: `Yerel kabul: feat_kds ${value}`,
  });
  const response = await fetch(`${labsOrigin}/urunler/prd_01arz3ndektsv4rrffq69g5fa7/kiracilar/tnt_01arz3ndektsv4rrffq69g5fav/istisna`, {
    method: 'POST', headers: { cookie, origin: labsOrigin, 'content-type': 'application/x-www-form-urlencoded' }, body: form,
    redirect: 'manual',
  });
  if (response.status !== 303) throw new Error(`Labs feature adjustment failed (${response.status})`);
}

async function verifyNative(apiOrigin, key, publicKeyHex, expectedFeatures) {
  const child = spawn('cargo', [
    'test', '--lib', 'native_process_applies_current_manual_feature_entitlement', '--', '--ignored', '--nocapture',
  ], {
    cwd: backend,
    env: { ...process.env, KASAM360_ACCEPTANCE_API_ORIGIN: apiOrigin, KASAM360_ACCEPTANCE_LICENSE_KEY: key,
      KASAM360_ACCEPTANCE_PUBLIC_KEY_HEX: publicKeyHex, KASAM360_ACCEPTANCE_EXPECTED_FEATURES: expectedFeatures.join(',') },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`Native desktop feature acceptance failed (${code})`);
}

try {
  console.log(`Isolated Labs state: ${labsData}`);
  const build = spawn('cargo', ['build', '--target-dir', labsTarget, '--manifest-path', path.join(labs, 'Cargo.toml')], { cwd: labs, stdio: 'inherit' });
  const buildCode = await new Promise((resolve, reject) => { build.once('error', reject); build.once('exit', resolve); });
  if (buildCode !== 0) throw new Error(`Labs build failed (${buildCode})`);
  labsProcess = launch(path.join(labsTarget, 'debug/labs360.exe'), [], labs, {
    NODE_ENV: 'development', LOCAL_TEST_MODE: '1', BIND_ADDR: `127.0.0.1:${labsPort}`, APP_ORIGIN: labsOrigin,
    DATA_DIR: labsData, ADMIN_BOOTSTRAP_EMAIL: 'manual-entitlement@kasam360.invalid', ADMIN_BOOTSTRAP_PASSWORD: adminPassword,
  });
  await ready(labsOrigin, labsProcess, 'Labs');
  const apiHeaders = { authorization: `Bearer ${labsToken}`, 'content-type': 'application/json' };
  const rightsUrl = `${labsOrigin}/api/v1/urunler/kasam360/kiracilar/tnt_01arz3ndektsv4rrffq69g5fav/hak`;
  const initialRights = await fetch(rightsUrl, { headers: apiHeaders }).then((response) => response.json());
  if (initialRights.status !== 'active' || !initialRights.featureKeys.includes('feat_kds')) throw new Error('TEST_A initial manual entitlement is not active');

  const login = await fetch(`${labsOrigin}/giris`, {
    method: 'POST', headers: { origin: labsOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'manual-entitlement@kasam360.invalid', password: adminPassword }), redirect: 'manual',
  });
  if (login.status !== 303) throw new Error(`Labs admin login failed (${login.status})`);
  const cookie = login.headers.getSetCookie().find((value) => value.startsWith('labs_session='))?.split(';')[0];
  if (!cookie) throw new Error('Labs admin session cookie missing');

  apiProcess = launch(process.execPath, ['--import', 'tsx', 'src/localTestServer.ts'], api, {
    NODE_ENV: 'development', LOCAL_TEST_MODE: '1', LOCAL_TEST_PORT: String(apiPort),
    LOCAL_TEST_LABS_ORIGIN: labsOrigin, LOCAL_TEST_LABS_TOKEN: labsToken,
    LOCAL_TEST_LICENSE_SIGNING_KEY: privateKey, LOCAL_TEST_PASSWORD: 'KasaTest-2026!',
  });
  await ready(`${apiOrigin}/__local-test/ready`, apiProcess, 'API');
  const keyResponse = await fetch(`${apiOrigin}/api/desktop/license-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner.a@kasam360.invalid', password: 'KasaTest-2026!' }),
  });
  if (keyResponse.status !== 201) throw new Error(`TEST_A local license key failed (${keyResponse.status})`);
  const { key } = await keyResponse.json();
  const deviceId = 'dev_01arz3ndektsv4rrffq69g5fa9';
  const activation = await fetch(`${apiOrigin}/api/desktop/tenants/tnt_01arz3ndektsv4rrffq69g5fav/activate`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': deviceId, 'content-type': 'application/json' },
    body: JSON.stringify({ tenantName: 'KASAM360 TEST_A', label: 'Hak kabul kasası', platform: 'windows' }),
  });
  if (!activation.ok) throw new Error(`TEST_A activation failed (${activation.status})`);

  for (const [setting, expected] of [['off', []], ['on', ['feat_kds']]]) {
    await applyFeatureOverride(cookie, setting);
    const rightsResponse = await fetch(rightsUrl, { headers: apiHeaders });
    const rights = await rightsResponse.json();
    if (!rightsResponse.ok || JSON.stringify(rights.featureKeys) !== JSON.stringify(expected)) throw new Error(`API effective rights mismatch after ${setting}`);
    const licenseResponse = await fetch(`${apiOrigin}/api/desktop/tenants/tnt_01arz3ndektsv4rrffq69g5fav/license/refresh`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-device-id': deviceId },
    });
    const license = await licenseResponse.json();
    if (!licenseResponse.ok || JSON.stringify(license.featureKeys) !== JSON.stringify(expected)) throw new Error(`Signed desktop license mismatch after ${setting}`);
    await verifyNative(apiOrigin, key, publicKeyHex, expected);
    console.log(`PASS: Labs ${setting} → API effective rights → signed V2 → native desktop ${expected.length ? 'feature open' : 'feature closed'}.`);
  }
} finally {
  stop(apiProcess);
  stop(labsProcess);
  setTimeout(() => rmSync(labsData, { recursive: true, force: true, maxRetries: 5 }), 1500);
}
