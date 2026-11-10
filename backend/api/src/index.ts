import { serve } from '@hono/node-server';
import { mountCustomerProvisioning } from './customerProvisioning.js';
import { createApp } from './app.js';
import { mountLicense, signingKey } from './license.js';
import { mongoLicenseKeys, mountDesktopLicense } from './desktopLicense.js';
import { mountDesktopTenantDevices } from './desktopTenantDevices.js';
import { allowedOrigins, auth, databases, siteUrl } from './config.js';
import { ensureIndexes } from './lib/mongo.js';
import { mongoDeviceLicenses } from './sync/deviceLicenses.js';
import { mountCloudSync } from './sync/routes.js';
import { labsQrMenuEntitlement } from './qrMenu/entitlement.js';
import { diskMenuMediaStore } from './qrMenu/mediaStore.js';
import { mountQrMenu } from './qrMenu/routes.js';
import { provisionLocalTestAccounts } from './localTestMode.js';

const { LABS_SUPPORT_ORIGIN, LABS_SUPPORT_TOKEN } = process.env;
const localTestMode = process.env.LOCAL_TEST_MODE === '1';
const support = localTestMode
  ? { origin: 'http://127.0.0.1:4000', token: 'local-test-support' }
  : LABS_SUPPORT_ORIGIN && LABS_SUPPORT_TOKEN
    ? { origin: LABS_SUPPORT_ORIGIN, token: LABS_SUPPORT_TOKEN } : undefined;

// Tekillik kuralları dizindedir; servis açılırken yoksa kurulur.
await ensureIndexes(databases);
if (localTestMode) await provisionLocalTestAccounts(databases);
const licenseKeys = mongoLicenseKeys(databases.account);
const deviceLicenses = mongoDeviceLicenses(databases.account);
const signing = process.env.LICENSE_SIGNING_KEY ? signingKey(process.env.LICENSE_SIGNING_KEY) : undefined;
const app = createApp(auth, allowedOrigins, siteUrl, support, licenseKeys, databases);
if (localTestMode) {
  const { mountLocalTestSupport } = await import('./localTestSupport.js');
  mountLocalTestSupport(app, support?.token ?? '');
}
mountLicense(app, auth, support, signing);
mountDesktopLicense(app, auth, licenseKeys, siteUrl, support, signing, deviceLicenses);
mountDesktopTenantDevices(app, auth, databases.accountClient, databases.account, licenseKeys, signing, deviceLicenses);
mountCloudSync(app, { db: databases.business, client: databases.businessClient }, licenseKeys, deviceLicenses, databases.account, auth);
mountQrMenu(app, {
  business: databases.business, businessClient: databases.businessClient, account: databases.account,
  keys: licenseKeys, devices: deviceLicenses, entitlement: labsQrMenuEntitlement(),
  media: process.env.MENU_MEDIA_DIR ? diskMenuMediaStore(process.env.MENU_MEDIA_DIR) : undefined,
  labsSecret: process.env.LABS_CUSTOMER_SECRET,
});
if (process.env.LABS_CUSTOMER_SECRET) mountCustomerProvisioning(app, databases, process.env.LABS_CUSTOMER_SECRET);

// HOST verilmezse davranış değişmez (üretimde ters vekil arkası); yerel başlatıcı yalnız 127.0.0.1 verir.
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000), ...(process.env.HOST ? { hostname: process.env.HOST } : {}) });
