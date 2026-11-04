import { Pool } from 'pg';
import { createAuth } from './lib/auth.js';
import { sendSmtpMail } from './lib/mail.js';

function required(name: string): string {
  const value = process.env[name];
  // Eksik sır veya veritabanıyla hesap servisi güvenli çalışamaz; servis hiç başlamaz.
  if (!value) throw new Error(`${name} tanımlı değil.`);
  return value;
}

export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);

export const pool = new Pool({ connectionString: required('DATABASE_URL') });

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

export const siteUrl = required('SITE_URL');

export const auth = createAuth({
  pool,
  secret: required('AUTH_SECRET'),
  siteUrl,
  allowedOrigins,
  sendMail: sendSmtpMail,
  google: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : undefined,
});
