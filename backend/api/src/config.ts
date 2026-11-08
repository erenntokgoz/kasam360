import { createAuth } from './lib/auth.js';
import { sendSmtpMail } from './lib/mail.js';
import { connectDatabases, type MongoSettings } from './lib/mongo.js';

function required(name: string): string {
  const value = process.env[name];
  // Eksik sır veya veritabanıyla hesap servisi güvenli çalışamaz; servis hiç başlamaz.
  if (!value) throw new Error(`${name} tanımlı değil.`);
  return value;
}

export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);

export const mongoSettings: MongoSettings = {
  accountUri: required('MONGODB_ACCOUNT_URI'),
  accountDb: process.env.MONGODB_ACCOUNT_DB || 'kasam360_account',
  businessUri: required('MONGODB_BUSINESS_URI'),
  businessDb: process.env.MONGODB_BUSINESS_DB || 'kasam360_business',
};

export const databases = await connectDatabases(mongoSettings);

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

export const siteUrl = required('SITE_URL');

export const auth = createAuth({
  databases,
  secret: required('AUTH_SECRET'),
  siteUrl,
  allowedOrigins,
  sendMail: sendSmtpMail,
  google: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : undefined,
});
