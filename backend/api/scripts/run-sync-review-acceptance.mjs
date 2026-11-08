import { spawn } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(api, '../..');
const web = path.join(root, 'web');
const fixture = { tenantId: 'tnt_01arz3ndektsv4rrffq69g5fav', ownerId: 'usr_01arz3ndektsv4rrffq69g5fav', email: 'owner.a@kasam360.invalid' };
const ids = { browserAccept: 'op_review_browser_accept', browserReject: 'op_review_browser_reject', duplicate: 'op_review_two_api_duplicate', race: 'op_review_accept_revoke_race', postRevoke: 'op_review_after_revoke' };
const operation = (operationId, deviceId, productId) => ({
  operationId, tenantId: fixture.tenantId, deviceId, actorId: fixture.ownerId, actorRole: 'OWNER', intentSha256: 'a'.repeat(64),
  op: { domain: 'CHANGES', body: { base_state: 0, changes: [{ table: 'products', action: 'I', key: { id: productId }, row: { id: productId, tenant_id: fixture.tenantId, name: productId } }] } },
  createdAt: '2026-11-06T10:00:00.000Z',
});
const contentHash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
    const address = server.address(); server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function launch(command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk)); child.stderr.on('data', (chunk) => process.stderr.write(chunk)); children.push(child); return child;
}
async function wait(url, child) {
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Sunucu erken kapandı: ${url}`);
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* start-up */ }
    await sleep(300);
  }
  throw new Error(`Sunucu hazır olmadı: ${url}`);
}
function stop(child) { if (child && child.exitCode === null) child.kill('SIGTERM'); }

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const mongo = await new MongoClient(repl.getUri()).connect();
let fakeLabs;
let keepAlive = true;
try {
  const business = mongo.db('business');
  const account = mongo.db('account');
  const now = new Date();
  const devices = {
    [ids.browserAccept]: 'dev_reviewweb01', [ids.browserReject]: 'dev_reviewweb01',
    [ids.duplicate]: 'dev_reviewapi01', [ids.race]: 'dev_reviewrace01', [ids.postRevoke]: 'dev_reviewrace01',
  };
  await business.collection('sync_tenant').insertOne({ tenant_id: fixture.tenantId, user_id: fixture.ownerId, last_seq: 0, created_at: now, touched_at: now });
  const docs = Object.entries(ids).map(([key, operationId]) => {
    const deviceId = devices[operationId]; const op = operation(operationId, deviceId, `prd_${key}`);
    return { tenant_id: fixture.tenantId, operation_id: operationId, user_id: fixture.ownerId, device_id: deviceId, content_sha256: contentHash(op), operation: op, changes: op.op.body.changes, status: 'pending', received_at: now };
  });
  await business.collection('sync_quarantine').insertMany(docs);
  for (const deviceId of new Set(Object.values(devices))) await account.collection('desktop_device_license').insertOne({
    user_id: fixture.ownerId, tenant_id: fixture.tenantId, device_id: deviceId, state: 'active', license_version: 2,
    paid_until: '2099-12-31T23:59:59.000Z', offline_until: '2099-12-31T23:59:59.000Z', valid_until: '2099-12-31',
    blocked: false, has_plan: true, checked_at: now,
  });

  fakeLabs = createServer((req, res) => {
    let data = ''; req.on('data', (chunk) => { data += chunk; }); req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.endsWith('/bagla')) return res.end(JSON.stringify({ tenantId: fixture.tenantId, linked: true }));
      if (url.pathname.endsWith('/cihazlar')) return res.end(JSON.stringify({ tenantId: fixture.tenantId, devices: [{ tenantId: fixture.tenantId, deviceId: 'dev_reviewrace01', label: 'Yarış kasası', platform: 'windows', status: 'active', registeredAt: now.toISOString(), version: 1 }] }));
      if (url.pathname.endsWith('/iptal')) return res.end(JSON.stringify({ tenantId: fixture.tenantId, deviceId: 'dev_reviewrace01', status: 'revoked', version: 2 }));
      res.statusCode = 404; res.end('{}');
    });
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => fakeLabs.once('listening', resolve));
  const labsPort = fakeLabs.address().port;
  const key = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const apiPorts = [await freePort(), await freePort()];
  const webPort = await freePort();
  const baseEnv = { LOCAL_TEST_MONGO_URI: repl.getUri(), LOCAL_TEST_LICENSE_SIGNING_KEY: key, LOCAL_TEST_LABS_ORIGIN: `http://127.0.0.1:${labsPort}`, LOCAL_TEST_LABS_TOKEN: 'local-test-support', LOCAL_TEST_WEB_ORIGIN: `http://127.0.0.1:${webPort}`, LOCAL_TEST_PASSWORD: 'KasaTest-2026!' };
  const origins = apiPorts.map((port) => `http://127.0.0.1:${port}`);
  const apis = [];
  for (const [index, port] of apiPorts.entries()) {
    const child = launch(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/localTestServer.ts'], api, { ...baseEnv, LOCAL_TEST_PORT: String(port) });
    apis.push(child);
    await wait(`${origins[index]}/__local-test/ready`, child);
  }
  const webChild = launch(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], web, {
    API_ORIGIN: origins[0], NEXT_DIST_DIR: '.next-sync-review-acceptance',
  });
  await wait(`http://127.0.0.1:${webPort}/hesabim`, webChild);

  const login = async (origin) => {
    const response = await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: `http://127.0.0.1:${webPort}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: fixture.email, password: 'KasaTest-2026!' }) });
    if (!response.ok) throw new Error(`Yerel OWNER oturumu açılamadı (${response.status})`);
    return response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  };
  const cookie = await login(origins[0]);
  const requestDecision = (origin, operationId, decision, reason) => fetch(`${origin}/v1/tenants/${fixture.tenantId}/sync/quarantine/${operationId}/resolve`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ decision, reason }),
  });
  const foreign = await fetch(`${origins[0]}/v1/tenants/tnt_01arz3ndektsv4rrffq69g5faw/sync/quarantine`, { headers: { cookie } });
  if (foreign.status !== 404) throw new Error(`TEST_B erişimi 404 olmadı (${foreign.status})`);
  const duplicate = await Promise.all([origins[0], origins[1]].map((origin) => requestDecision(origin, ids.duplicate, 'accept', 'Aynı işlem kararı')));
  if (duplicate.some((response) => !response.ok)) throw new Error(`Ayrı API süreçlerinde tekrarlı karar başarısız: ${duplicate.map((r) => r.status)}`);
  if (await business.collection('sync_operation').countDocuments({ tenant_id: fixture.tenantId, operation_id: ids.duplicate }) !== 1) throw new Error('Tekrarlı karar ikinci eşitleme işlemi üretti.');

  const [acceptRace, revokeRace] = await Promise.all([
    requestDecision(origins[0], ids.race, 'accept', 'İşlem kabul edildi'),
    fetch(`${origins[1]}/v1/tenants/${fixture.tenantId}/devices/dev_reviewrace01/revoke`, { method: 'POST', headers: { cookie } }),
  ]);
  if (!((acceptRace.ok && (revokeRace.ok || revokeRace.status === 409)) || (acceptRace.status === 403 && revokeRace.ok))) {
    throw new Error(`Kabul/iptal yarışı beklenmeyen sonuç verdi: kabul ${acceptRace.status}, iptal ${revokeRace.status}`);
  }
  if (revokeRace.status === 409) {
    const retry = await fetch(`${origins[1]}/v1/tenants/${fixture.tenantId}/devices/dev_reviewrace01/revoke`, { method: 'POST', headers: { cookie } });
    if (!retry.ok) throw new Error(`Cihaz iptali karar sonrası tekrarlanamadı (${retry.status})`);
  }
  const revokedReview = await requestDecision(origins[1], ids.postRevoke, 'accept', 'Sonradan kabul denemesi');
  if (revokedReview.status !== 403) throw new Error(`İptalden sonra inceleme kabul edildi (${revokedReview.status})`);

  console.log(`SYNC_REVIEW_ACCEPTANCE_READY=http://127.0.0.1:${webPort}/hesabim`);
  console.log('Accounts: owner.a@kasam360.invalid / owner.b@kasam360.invalid');
  console.log('Password: KasaTest-2026!');
  console.log('Passed: TEST_B isolation, separate API processes duplicate decision, accept/revoke race and post-revoke denial. Browser rows: one accept and one reject in TEST_A.');
  await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally {
  for (const child of children) stop(child);
  fakeLabs?.close(); await mongo.close(); await repl.stop(); keepAlive = false;
}
