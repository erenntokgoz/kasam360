import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const labs = path.resolve(root, '../360labs');
const api = path.join(root, 'backend/api');
const backend = path.join(root, 'backend');
const localData = path.join(labs, '.local-acceptance-data');
const labsIntegrationToken = 'labs_0000000000000000000000000000000000000000000000000000000000000000';

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

function launch(command, args, cwd, env, shell = false) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} stopped before becoming ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch { /* process is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${label} readiness timed out`);
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
}

const labsPort = await port();
const apiPort = await port();
const labsOrigin = `http://127.0.0.1:${labsPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const publicKeyHex = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const bootstrapPassword = `Local-${randomUUID()}-aA9!`;
let labsProcess;
let apiProcess;

try {
  console.log(`Persistent isolated Labs catalog: ${localData}`);
  const build = spawn('cargo', ['build', '--manifest-path', path.join(labs, 'Cargo.toml')], { cwd: labs, stdio: 'inherit' });
  const buildCode = await new Promise((resolve, reject) => {
    build.once('error', reject);
    build.once('exit', resolve);
  });
  if (buildCode !== 0) throw new Error(`Labs build failed (${buildCode})`);

  const labsBinary = path.join(labs, 'target/debug/labs360.exe');
  labsProcess = launch(labsBinary, [], labs, {
    NODE_ENV: 'development', LOCAL_TEST_MODE: '1',
    BIND_ADDR: `127.0.0.1:${labsPort}`, APP_ORIGIN: labsOrigin,
    DATA_DIR: localData,
    ADMIN_BOOTSTRAP_EMAIL: 'local-acceptance@kasam360.invalid',
    ADMIN_BOOTSTRAP_PASSWORD: bootstrapPassword,
  });
  await waitFor(labsOrigin, labsProcess, 'Labs');
  const labsHeaders = { authorization: `Bearer ${labsIntegrationToken}`, 'content-type': 'application/json' };
  const catalogResponse = await fetch(`${labsOrigin}/api/v1/urunler/kasam360/katalog`, { headers: labsHeaders });
  if (!catalogResponse.ok) throw new Error(`Labs catalog unavailable (${catalogResponse.status})`);
  const catalog = await catalogResponse.json();
  if (!catalog.packages?.some((item) => item.packageId === 'pkg_01arz3ndektsv4rrffq69g5fa1' &&
      item.price?.amountCents === 125000 && item.deviceLimit === 2 && item.featureKeys?.includes('feat_kds'))) {
    throw new Error('Persistent Labs acceptance catalog is incomplete');
  }
  for (const [tenantId, tenantName, expected] of [
    ['tnt_01arz3ndektsv4rrffq69g5fav', 'KASAM360 TEST_A', 'active'],
    ['tnt_01arz3ndektsv4rrffq69g5faw', 'KASAM360 TEST_B', 'inactive'],
  ]) {
    const linked = await fetch(`${labsOrigin}/api/v1/urunler/kasam360/kiracilar/${tenantId}/bagla`, {
      method: 'PUT', headers: labsHeaders, body: JSON.stringify({ name: tenantName }),
    });
    if (!linked.ok) throw new Error(`Labs tenant link failed (${linked.status})`);
    const rightsResponse = await fetch(`${labsOrigin}/api/v1/urunler/kasam360/kiracilar/${tenantId}/hak`, { headers: labsHeaders });
    const rights = await rightsResponse.json();
    if (!rightsResponse.ok || rights.status !== expected) throw new Error(`Labs ${tenantName} entitlement mismatch`);
  }
  console.log('Labs catalog: published TEST_A package, 125000 cents TRY/month, 2 devices, feat_kds; TEST_B has no entitlement.');

  apiProcess = launch(process.execPath, ['--import', 'tsx', 'src/localTestServer.ts'], api, {
    NODE_ENV: 'development', LOCAL_TEST_MODE: '1', LOCAL_TEST_PORT: String(apiPort),
    LOCAL_TEST_LABS_ORIGIN: labsOrigin, LOCAL_TEST_LABS_TOKEN: labsIntegrationToken,
    LOCAL_TEST_LICENSE_SIGNING_KEY: privateKey,
    LOCAL_TEST_PASSWORD: 'KasaTest-2026!',
  });
  await waitFor(`${apiOrigin}/__local-test/ready`, apiProcess, 'API');
  const keyResponse = await fetch(`${apiOrigin}/__local-test/signing-public-key`);
  if (!keyResponse.ok) throw new Error('Sandbox verification key was not served');
  const keyBody = await keyResponse.json();
  if (keyBody.publicKeyHex !== publicKeyHex) throw new Error('Sandbox signing key pair mismatch');

  const desktopKeyResponse = await fetch(`${apiOrigin}/api/desktop/license-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner.a@kasam360.invalid', password: 'KasaTest-2026!' }),
  });
  if (desktopKeyResponse.status !== 201) throw new Error(`TEST_A safe key issuance failed (${desktopKeyResponse.status})`);
  const { key } = await desktopKeyResponse.json();
  const activation = await fetch(`${apiOrigin}/api/desktop/tenants/tnt_01arz3ndektsv4rrffq69g5fav/activate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'x-device-id': 'dev_01arz3ndektsv4rrffq69g5fa9', 'content-type': 'application/json' },
    body: JSON.stringify({ tenantName: 'KASAM360 TEST_A', label: 'Yerel kabul kasası', platform: 'windows' }),
  });
  if (activation.status !== 200) {
    const detail = await activation.text();
    throw new Error(`TEST_A Labs device activation failed (${activation.status}): ${detail}`);
  }
  console.log('Labs activation endpoint: HTTP 200 (TEST_A fixture device).');
  const result = spawn('cargo', [
    'test', '--lib', 'native_process_activation_signed_v2_and_sync_acceptance', '--', '--ignored', '--nocapture',
  ], {
    cwd: backend,
    env: {
      ...process.env,
      KASAM360_ACCEPTANCE_API_ORIGIN: apiOrigin,
      KASAM360_ACCEPTANCE_LICENSE_KEY: key,
      KASAM360_ACCEPTANCE_PUBLIC_KEY_HEX: publicKeyHex,
    },
    stdio: 'inherit',
  });
  const testCode = await new Promise((resolve, reject) => {
    result.once('error', reject);
    result.once('exit', resolve);
  });
  if (testCode !== 0) throw new Error(`Native process acceptance failed (${testCode})`);
  console.log('PASS: actual Labs process → API activation → signed V2 → native desktop sync push/pull.');
  console.log('The isolated Labs database remains populated for repeat runs; API Mongo is ephemeral per run.');
} finally {
  stop(apiProcess);
  stop(labsProcess);
}
