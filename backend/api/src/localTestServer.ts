import { serve } from '@hono/node-server';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { createApp } from './app.js';
import { createAuth } from './lib/auth.js';
import { closeDatabases, connectDatabases, ensureIndexes } from './lib/mongo.js';
import { provisionLocalTestAccounts } from './localTestMode.js';
import { mongoLicenseKeys, mountDesktopLicense } from './desktopLicense.js';
import { mountDesktopTenantDevices } from './desktopTenantDevices.js';
import { signingKey, mountLicense } from './license.js';
import { mongoDeviceLicenses } from './sync/deviceLicenses.js';
import { mountCloudSync } from './sync/routes.js';
import { mountLocalTestSupport } from './localTestSupport.js';

if (process.env.NODE_ENV === 'production') throw new Error('Yerel kabul sunucusu production ortamında başlatılamaz.');
process.env.LOCAL_TEST_MODE = '1';
const host = '127.0.0.1';
const port = Number(process.env.LOCAL_TEST_PORT ?? 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_TEST_PORT geçersiz.');
const origin = `http://${host}:${port}`;
const webOrigin = process.env.LOCAL_TEST_WEB_ORIGIN ?? 'http://127.0.0.1:3002';
const replSet = process.env.LOCAL_TEST_MONGO_URI ? null : await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = process.env.LOCAL_TEST_MONGO_URI ?? replSet?.getUri();
if (!uri) throw new Error('Yerel test Mongo adresi hazırlanamadı.');
const databases = await connectDatabases({ accountUri: uri, accountDb: 'account', businessUri: uri, businessDb: 'business' });
const mails: { to: string; subject: string; text: string }[] = [];

try {
  await ensureIndexes(databases);
  const auth = createAuth({
    databases,
    secret: 'local-only-kasam360-test-secret-not-for-reuse',
    siteUrl: origin,
    allowedOrigins: [origin, webOrigin],
    sendMail: async (mail) => { mails.push(mail); },
  });
  await provisionLocalTestAccounts(databases);
  const keys = mongoLicenseKeys(databases.account);
  const localSupport = { origin, token: 'local-test-support' };
  // Labs ticari hak uçları cihaz akışıyla aynı test Labs'ına bağlanır; aksi halde Hesabım hakları 503 görür.
  const labs = {
    labsOrigin: process.env.LOCAL_TEST_LABS_ORIGIN ?? 'http://127.0.0.1:3600',
    labsToken: process.env.LOCAL_TEST_LABS_TOKEN ?? 'local-test-support',
  };
  const app = createApp(auth, [origin, webOrigin], origin, localSupport, keys, databases, labs);
  mountLocalTestSupport(app, 'local-test-support');
  const localPrivateKey = process.env.LOCAL_TEST_LICENSE_SIGNING_KEY ??
    generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const signing = signingKey(localPrivateKey);
  const publicBytes = createPublicKey(signing).export({ format: 'der', type: 'spki' }).subarray(-32);
  app.get('/__local-test/ready', (context) => context.json({ ready: true }));
  app.get('/__local-test/signing-public-key', (context) => context.json({ publicKeyHex: publicBytes.toString('hex') }));
  mountLicense(app, auth, { origin, token: 'local-test-support' }, signing);
  mountDesktopLicense(app, auth, keys, origin, { origin, token: 'local-test-support' }, signing, mongoDeviceLicenses(databases.account));
  mountDesktopTenantDevices(app, auth, databases.accountClient, databases.account, keys, signing, mongoDeviceLicenses(databases.account), labs);
  mountCloudSync(app, { db: databases.business, client: databases.businessClient }, keys, mongoDeviceLicenses(databases.account), databases.account, auth);
  const server = serve({ fetch: app.fetch, hostname: host, port });
  process.stdout.write(`Local test API: ${origin}\nMongo: ephemeral replica set\nMail: in-memory sink (${mails.length} messages)\nAccounts: owner.a@kasam360.invalid / owner.b@kasam360.invalid\nPassword: ${process.env.LOCAL_TEST_PASSWORD ?? 'KasaTest-2026!'}\n`);
  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabases(databases);
    await replSet?.stop();
  };
  process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
} catch (error) {
  await closeDatabases(databases);
  await replSet?.stop();
  throw error;
}
