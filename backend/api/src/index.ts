import { serve } from '@hono/node-server';
import { mountCustomerProvisioning } from './customerProvisioning.js';
import { createApp } from './app.js';
import { mountLicense, signingKey } from './license.js';
import { LICENSE_KEY_TABLE, mountDesktopLicense, pgLicenseKeys } from './desktopLicense.js';
import { allowedOrigins, auth, pool, siteUrl } from './config.js';

const { LABS_SUPPORT_ORIGIN, LABS_SUPPORT_TOKEN } = process.env;
const support = LABS_SUPPORT_ORIGIN && LABS_SUPPORT_TOKEN
  ? { origin: LABS_SUPPORT_ORIGIN, token: LABS_SUPPORT_TOKEN } : undefined;

// Masaüstü lisans anahtarı tablosu hesap tablosuna bağlıdır; servis açılırken yoksa kurulur.
await pool.query(LICENSE_KEY_TABLE);
const licenseKeys = pgLicenseKeys(pool);
const signing = process.env.LICENSE_SIGNING_KEY ? signingKey(process.env.LICENSE_SIGNING_KEY) : undefined;
const app = createApp(auth, allowedOrigins, siteUrl, support, licenseKeys);
mountLicense(app, auth, support, signing);
mountDesktopLicense(app, auth, licenseKeys, siteUrl, support, signing);
if (process.env.LABS_CUSTOMER_SECRET) mountCustomerProvisioning(app, pool, process.env.LABS_CUSTOMER_SECRET);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) });
