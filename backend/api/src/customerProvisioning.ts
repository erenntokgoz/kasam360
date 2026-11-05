
import { timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Pool } from 'pg';

const PAGE = 500;

export function mountCustomerProvisioning(app: Hono, pool: Pool, secret: string) {
  const path = '/internal/labs/customers';
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
    const { rows } = await pool.query(
      `SELECT id,name,email,"businessName","emailVerified" FROM "user"
       WHERE id > $1 ORDER BY id LIMIT $2`,
      [after, PAGE + 1],
    );
    const more = rows.length > PAGE;
    const accounts = more ? rows.slice(0, PAGE) : rows;
    return context.json({ accounts, next: more ? accounts[accounts.length - 1].id : null });
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
    const inserted = await pool.query(
      `WITH new_user AS (
          INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
          VALUES ($1,$2,$3,false,now(),now()) ON CONFLICT DO NOTHING RETURNING id
       )
       INSERT INTO account (id,"userId","accountId","providerId",password,"createdAt","updatedAt")
       SELECT $4,id,id,'credential',$5,now(),now() FROM new_user RETURNING id`,
      [userId, data.name.trim(), email, accountId, await hash(data.password)],
    );
    if (inserted.rowCount === 1) return context.json({ id: userId }, 201);
    const existing = await pool.query<{ password: string }>(
      `SELECT a.password FROM "user" u JOIN account a ON a."userId"=u.id
       WHERE u.id=$1 AND u.email=$2 AND a.id=$3 AND a."providerId"='credential'`,
      [userId, email, accountId],
    );
    if (existing.rows[0]?.password && await verify(existing.rows[0].password, data.password)) {
      return context.json({ id: userId });
    }
    return context.body(null, 409);
  });
}
