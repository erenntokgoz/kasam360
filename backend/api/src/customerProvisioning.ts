
import { timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Databases } from './lib/mongo.js';

const PAGE = 500;

// Hesap kütüphanesinin belge biçimi; kayıt aynı alanlarla açılır ki girişte aynen okunsun.
interface CustomerUser {
  _id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  businessName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CustomerAccount {
  _id: string;
  userId: string;
  accountId: string;
  providerId: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

export function mountCustomerProvisioning(app: Hono, { account, accountClient }: Databases, secret: string) {
  const path = '/internal/labs/customers';
  const users = account.collection<CustomerUser>('user');
  const accounts = account.collection<CustomerAccount>('account');
  const authorized = (header: string | undefined) => {
    const supplied = Buffer.from(header ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    return secret.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  app.use(path, bodyLimit({ maxSize: 4096 }));
  // Panel işletme listesini buradan sayfa sayfa okur; şifre ve oturum bilgisi dönmez.
  // Kimlikler ULID olduğundan kimlik sırası açılış sırasıdır; `next` boşsa liste bitmiştir.
  app.get(path, async (context) => {
    context.header('Cache-Control', 'no-store');
    if (!authorized(context.req.header('authorization'))) return context.body(null, 401);
    const after = context.req.query('after') ?? '';
    if (after && !/^[a-z]{2,4}_[0-9A-Za-z]{1,40}$/.test(after)) return context.body(null, 422);
    const found = await users.find(after ? { _id: { $gt: after } } : {}, {
      projection: { name: 1, email: 1, businessName: 1, emailVerified: 1 },
    }).sort({ _id: 1 }).limit(PAGE + 1).toArray();
    const rows = found.map(({ _id, name, email, businessName, emailVerified }) => ({
      id: _id, name, email, businessName: businessName ?? null, emailVerified: emailVerified === true,
    }));
    const more = rows.length > PAGE;
    const page = more ? rows.slice(0, PAGE) : rows;
    return context.json({ accounts: page, next: more ? page[page.length - 1].id : null });
  });
  app.post(path, async (context) => {
    context.header('Cache-Control', 'no-store');
    if (!authorized(context.req.header('authorization'))) return context.body(null, 401);
    const data: unknown = await context.req.json().catch(() => null);
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' ||
        !/^cus_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(data.id) ||
        !('email' in data) || typeof data.email !== 'string' || data.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
        !('name' in data) || typeof data.name !== 'string' || !data.name.trim() || [...data.name].length > 120 ||
        !('password' in data) || typeof data.password !== 'string' ||
        Buffer.byteLength(data.password) < 8 || Buffer.byteLength(data.password) > 128) {
      return context.body(null, 422);
    }
    const suffix = data.id.slice(4).toLowerCase();
    const userId = `usr_${suffix}`;
    const accountId = `acc_${suffix}`;
    const email = data.email.toLowerCase();
    // Hesap ve kimlik bilgisi tek yazımda açılır. Müşterinin onayı ve e-posta doğrulaması sonradan alınır.
    const name = data.name.trim();
    const passwordHash = await hash(data.password);
    const now = new Date();
    const session = accountClient.startSession();
    let created = false;
    try {
      await session.withTransaction(async () => {
        created = false;
        if (await users.findOne({ $or: [{ _id: userId }, { email }] }, { session })) return;
        await users.insertOne({ _id: userId, name, email, emailVerified: false, createdAt: now, updatedAt: now }, { session });
        await accounts.insertOne({
          _id: accountId, userId, accountId: userId, providerId: 'credential', password: passwordHash, createdAt: now, updatedAt: now,
        }, { session });
        created = true;
      });
    } finally {
      await session.endSession();
    }
    if (created) return context.json({ id: userId }, 201);
    const user = await users.findOne({ _id: userId, email });
    const credential = user ? await accounts.findOne({ _id: accountId, userId, providerId: 'credential' }) : null;
    if (credential?.password && await verify(credential.password, data.password)) {
      return context.json({ id: userId });
    }
    return context.body(null, 409);
  });
}
