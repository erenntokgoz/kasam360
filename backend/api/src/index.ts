import { serve } from '@hono/node-server';
import { mountCustomerProvisioning } from './customerProvisioning.js';
import { createApp } from './app.js';
import { allowedOrigins, auth, pool, siteUrl } from './config.js';

const { LABS_SUPPORT_ORIGIN, LABS_SUPPORT_TOKEN } = process.env;
const support = LABS_SUPPORT_ORIGIN && LABS_SUPPORT_TOKEN
  ? { origin: LABS_SUPPORT_ORIGIN, token: LABS_SUPPORT_TOKEN } : undefined;

const app = createApp(auth, allowedOrigins, siteUrl, support);
if (process.env.LABS_CUSTOMER_SECRET) mountCustomerProvisioning(app, pool, process.env.LABS_CUSTOMER_SECRET);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) });
