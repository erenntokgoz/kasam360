import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { sendLeadMail } from './lib/sendLeadMail.js';

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = createApp({
  allowedOrigins,
  contactEmail: process.env.CONTACT_EMAIL ?? 'iletisim@kasam360.com.tr',
  sendMail: sendLeadMail,
});

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) });
