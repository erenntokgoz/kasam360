import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Db, MongoClient } from 'mongodb';
import type { LicenseKeys } from '../desktopLicense.js';
import { TENANT_ID } from '../contracts/commercialChain.js';
import { prefixedId } from '../lib/prefixedId.js';
import { authorize } from '../sync/routes.js';
import type { DeviceLicenses } from '../sync/deviceLicenses.js';
import { SyncError } from '../sync/validate.js';
import type { QrMenuEntitlement } from './entitlement.js';
import { MENU_SCHEMA, MenuInvalid, canonicalMenu, menuEtag, parseMenu, type MenuSnapshot } from './menuSchema.js';
import type { MenuMediaStore } from './mediaStore.js';
import { checkSlug } from './slug.js';
import { MAX_IMAGE_BYTES, inspectWebp } from './webp.js';

// Sözleşme docs/contracts/qr-menu.md. İlk sürüm yalnız gösterimdir; sipariş yoktur.
// Slug'ı yalnız Labs atar: işletme tarafında slug yazan hiçbir uç yoktur.

const DESKTOP = '/api/desktop/tenants/:tenantId/menu';
const INTERNAL = '/internal/labs/qr-menu/:tenantId/slug';
const IMAGE_QUOTA = 500;
// Masaüstünün yerel işletme kimliği biçimi de kabul edilir (desktopTenantDevices ile aynı kural).
const tenantIdValid = (value: string) => TENANT_ID.test(value) || /^tnt_[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value);

export interface QrMenuDeps {
  business: Db;
  businessClient: MongoClient;
  account: Db;
  keys: LicenseKeys;
  devices: DeviceLicenses;
  entitlement: QrMenuEntitlement;
  media?: MenuMediaStore;
  /** Labs ↔ API ortak sırrı; yoksa slug ucu hiç bağlanmaz. */
  labsSecret?: string;
}

interface SlugDoc { _id: string; tenant_id: string; slug: string; enabled: boolean; created_at: Date; updated_at: Date }
interface PublicationDoc { _id: string; tenant_id: string; version: number; etag: string; menu: MenuSnapshot; published_at: Date; published_by_device: string }
interface ImageDoc { _id: string; tenant_id: string; sha256: string; size: number; width: number; height: number; created_at: Date }
interface TenantDoc { _id: string; name: string; currency: string; status: string }

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 503;

function fail(context: Context, status: ErrorStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
  context.header('Cache-Control', 'no-store');
  return context.json({ code, message, ...extra }, status);
}

const duplicateKey = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 11000;

export function mountQrMenu(app: Hono, deps: QrMenuDeps) {
  const slugs = deps.business.collection<SlugDoc>('qr_menu_slug');
  const publications = deps.business.collection<PublicationDoc>('qr_menu_publication');
  const images = deps.business.collection<ImageDoc>('qr_menu_image');

  /** Masaüstü kimliği: mevcut tenant sync cihaz lisansı; cihaz bu işletmeye bağlı ve etkin olmalı. */
  async function desktop(context: Context) {
    const tenantId = context.req.param('tenantId') ?? '';
    if (!tenantIdValid(tenantId)) return { response: fail(context, 404, 'NOT_FOUND', 'İşletme bulunamadı.') };
    try {
      const { deviceId } = await authorize(context, deps.keys, deps.devices, 'read', tenantId);
      return { tenantId, deviceId };
    } catch (error) {
      if (error instanceof SyncError) return { response: fail(context, error.status, error.code, error.message) };
      throw error;
    }
  }

  /** Yayın ve yükleme hak ister; hak doğrulanamıyorsa yazılmaz. */
  async function entitled(context: Context, tenantId: string) {
    const answer = await deps.entitlement.check(tenantId);
    if (answer === 'yes') return null;
    if (answer === 'no') return fail(context, 403, 'FEATURE_NOT_ENTITLED', 'Bu işletmenin paketinde QR menü yok.');
    return fail(context, 503, 'UPSTREAM_UNAVAILABLE', 'İşletme hakkı şu anda doğrulanamıyor.');
  }

  app.use(DESKTOP, bodyLimit({ maxSize: 1024 * 1024, onError: (context) => fail(context, 413, 'PAYLOAD_TOO_LARGE', 'Menü çok büyük.') }));
  app.use(`${DESKTOP}/images`, bodyLimit({ maxSize: MAX_IMAGE_BYTES, onError: (context) => fail(context, 413, 'PAYLOAD_TOO_LARGE', 'Görsel 1,5 MB sınırını aşıyor.') }));

  app.put(DESKTOP, async (context) => {
    const found = await desktop(context);
    if ('response' in found) return found.response;
    const { tenantId, deviceId } = found;
    const denied = await entitled(context, tenantId);
    if (denied) return denied;
    let menu: MenuSnapshot;
    try {
      menu = parseMenu(await context.req.json().catch(() => { throw new MenuInvalid('body'); }));
    } catch (error) {
      if (error instanceof MenuInvalid) return fail(context, 422, 'INVALID_MENU', 'Menü biçimi geçersiz.', { field: error.field });
      throw error;
    }
    const canonical = canonicalMenu(menu);
    const etag = menuEtag(canonical);
    const keys = [...new Set(canonical.products.flatMap((product) => (product.imageKey ? [product.imageKey] : [])))];

    type Outcome = { version: number; changed: boolean } | { missing: string };
    const state: { outcome: Outcome | null } = { outcome: null };
    // İlk yayında iki cihaz aynı anda belge açmaya çalışırsa tekil dizin biri reddeder; bir kez yeniden denenir.
    for (let attempt = 0; attempt < 2 && !state.outcome; attempt += 1) {
      const session = deps.businessClient.startSession();
      try {
        await session.withTransaction(async () => {
          state.outcome = null;
          if (keys.length) {
            const known = await images.find({ tenant_id: tenantId, sha256: { $in: keys } }, { session, projection: { sha256: 1 } }).toArray();
            const have = new Set(known.map((doc) => doc.sha256));
            const missing = keys.find((key) => !have.has(key));
            if (missing) { state.outcome = { missing }; return; }
          }
          const current = await publications.findOne({ tenant_id: tenantId }, { session });
          if (current && current.etag === etag) { state.outcome = { version: current.version, changed: false }; return; }
          const version = (current?.version ?? 0) + 1;
          await publications.updateOne(
            { tenant_id: tenantId },
            { $set: { version, etag, menu: canonical, published_at: new Date(), published_by_device: deviceId }, $setOnInsert: { _id: prefixedId('qr_menu_publication') } },
            { upsert: true, session },
          );
          state.outcome = { version, changed: true };
        });
      } catch (error) {
        if (!duplicateKey(error) || attempt === 1) throw error;
      } finally {
        await session.endSession();
      }
    }
    const { outcome } = state;
    if (!outcome) return fail(context, 503, 'BUSY', 'Yayın şu anda tamamlanamadı; tekrar deneyin.');
    if ('missing' in outcome) return fail(context, 422, 'UNKNOWN_IMAGE', 'Menüdeki bir görsel bu işletmeye yüklenmemiş.', { imageKey: outcome.missing });
    const slug = await slugs.findOne({ tenant_id: tenantId });
    context.header('Cache-Control', 'no-store');
    return context.json({
      tenantId, version: outcome.version, etag, changed: outcome.changed,
      slug: slug?.slug ?? null, publicPath: slug ? `/${slug.slug}` : null,
    });
  });

  app.get(`${DESKTOP}/status`, async (context) => {
    const found = await desktop(context);
    if ('response' in found) return found.response;
    const { tenantId } = found;
    const [slug, publication, answer] = await Promise.all([
      slugs.findOne({ tenant_id: tenantId }), publications.findOne({ tenant_id: tenantId }), deps.entitlement.check(tenantId),
    ]);
    context.header('Cache-Control', 'no-store');
    return context.json({
      tenantId, slug: slug?.slug ?? null, enabled: slug?.enabled ?? false, entitled: answer === 'yes',
      version: publication?.version ?? null, etag: publication?.etag ?? null, publishedAt: publication?.published_at.toISOString() ?? null,
    });
  });

  app.put(`${DESKTOP}/images`, async (context) => {
    const found = await desktop(context);
    if ('response' in found) return found.response;
    const { tenantId } = found;
    const denied = await entitled(context, tenantId);
    if (denied) return denied;
    if (!deps.media) return fail(context, 503, 'MEDIA_UNAVAILABLE', 'Görsel depolama yapılandırılmamış.');
    const type = (context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'image/webp') return fail(context, 415, 'UNSUPPORTED_IMAGE', 'Yalnız WebP görsel kabul edilir.');
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    if (bytes.length === 0) return fail(context, 422, 'INVALID_IMAGE', 'Görsel boş.');
    if (bytes.length > MAX_IMAGE_BYTES) return fail(context, 413, 'PAYLOAD_TOO_LARGE', 'Görsel 1,5 MB sınırını aşıyor.');
    const inspected = inspectWebp(bytes);
    if (!inspected.ok) {
      return inspected.reason === 'not_webp'
        ? fail(context, 415, 'UNSUPPORTED_IMAGE', 'Dosya WebP görsel değil.')
        : fail(context, 422, 'INVALID_IMAGE', 'Görsel bozuk veya 1600 px sınırını aşıyor.');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await images.findOne({ tenant_id: tenantId, sha256 });
    if (!existing && (await images.countDocuments({ tenant_id: tenantId })) >= IMAGE_QUOTA) {
      return fail(context, 422, 'IMAGE_QUOTA', 'İşletme başına en çok 500 görsel yüklenebilir.');
    }
    // Dosya önce yazılır: belge varsa dosya da vardır; yarım kalan yükleme tekrarla tamamlanır.
    await deps.media.put(tenantId, sha256, bytes);
    const written = await images.updateOne(
      { tenant_id: tenantId, sha256 },
      { $setOnInsert: { _id: prefixedId('qr_menu_image'), size: bytes.length, width: inspected.width, height: inspected.height, created_at: new Date() } },
      { upsert: true },
    );
    context.header('Cache-Control', 'no-store');
    return context.json({ key: sha256, size: bytes.length, width: inspected.width, height: inspected.height }, written.upsertedCount ? 201 : 200);
  });

  // Public okuma: üç koşul (slug açık, menü yayında, hak var) birlikte yoksa tek tip 404.
  const missing = (context: Context) => {
    context.header('Cache-Control', 'public, max-age=15');
    return context.json({ code: 'NOT_FOUND' }, 404);
  };

  async function visible(slug: string) {
    if (checkSlug(slug) !== 'ok') return null;
    const doc = await slugs.findOne({ slug });
    if (!doc?.enabled) return null;
    const publication = await publications.findOne({ tenant_id: doc.tenant_id });
    if (!publication) return null;
    if ((await deps.entitlement.check(doc.tenant_id, { allowStale: true })) !== 'yes') return null;
    return { tenantId: doc.tenant_id, publication };
  }

  app.use('/public/menu/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD'] }));

  app.get('/public/menu/:slug', async (context) => {
    const slug = context.req.param('slug');
    const found = await visible(slug);
    if (!found) return missing(context);
    const { publication } = found;
    context.header('ETag', publication.etag);
    context.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    context.header('X-Content-Type-Options', 'nosniff');
    if (context.req.header('if-none-match') === publication.etag) return context.body(null, 304);
    const tenant = await deps.account.collection<TenantDoc>('tenant').findOne({ _id: found.tenantId }, { projection: { currency: 1, name: 1 } });
    const items = publication.menu.products.filter((product) => product.active);
    const categories = publication.menu.categories
      .map((category) => ({
        id: category.id, name: category.name, sortOrder: category.sortOrder,
        products: items.filter((product) => product.categoryId === category.id).map((product) => ({
          id: product.id, name: product.name, description: product.description, priceCents: product.priceCents,
          sortOrder: product.sortOrder, inStock: product.inStock,
          image: product.imageKey ? `/public/menu/${slug}/images/${product.imageKey}.webp` : null,
        })),
      }))
      .filter((category) => category.products.length > 0);
    return context.json({
      schema: MENU_SCHEMA, slug, name: publication.menu.businessName ?? tenant?.name ?? null, version: publication.version, publishedAt: publication.published_at.toISOString(),
      currency: tenant?.currency ?? 'TRY', categories,
    });
  });

  app.get('/public/menu/:slug/images/:file', async (context) => {
    const hash = /^([0-9a-f]{64})\.webp$/.exec(context.req.param('file'))?.[1];
    const found = hash && deps.media ? await visible(context.req.param('slug')) : null;
    // Yalnız yayınlanmış menüde kullanılan görsel verilir; yüklenip yayına girmemiş görsel görünmez.
    if (!hash || !deps.media || !found || !found.publication.menu.products.some((product) => product.active && product.imageKey === hash)) return missing(context);
    const bytes = await deps.media.get(found.tenantId, hash);
    if (!bytes) return missing(context);
    return context.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'image/webp',
      // İçerik-adresli olduğundan içerik değişmez; uzun ve değişmez önbellek güvenlidir.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  const secret = deps.labsSecret;
  if (secret && secret.length >= 32) {
    const authorized = (header: string | undefined) => {
      const supplied = Buffer.from(header ?? '');
      const expected = Buffer.from(`Bearer ${secret}`);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    };
    app.use(INTERNAL, bodyLimit({ maxSize: 1024 }));
    app.put(INTERNAL, async (context) => {
      context.header('Cache-Control', 'no-store');
      if (!authorized(context.req.header('authorization'))) return context.body(null, 401);
      const tenantId = context.req.param('tenantId') ?? '';
      const data: unknown = await context.req.json().catch(() => null);
      if (!tenantIdValid(tenantId)) return fail(context, 404, 'TENANT_NOT_FOUND', 'İşletme bulunamadı.');
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((key) => key !== 'slug' && key !== 'enabled') ||
          !('enabled' in data) || typeof data.enabled !== 'boolean') {
        return fail(context, 422, 'INVALID_SLUG', 'İstek biçimi geçersiz.');
      }
      const slug = 'slug' in data ? data.slug : undefined;
      const verdict = checkSlug(slug);
      if (verdict === 'reserved') return fail(context, 422, 'SLUG_RESERVED', 'Bu adres ayrılmış.');
      if (verdict !== 'ok' || typeof slug !== 'string') return fail(context, 422, 'INVALID_SLUG', 'Adres biçimi geçersiz.');
      const tenant = await deps.account.collection<TenantDoc>('tenant').findOne({ _id: tenantId, status: 'active' });
      if (!tenant) return fail(context, 404, 'TENANT_NOT_FOUND', 'İşletme bulunamadı.');
      const now = new Date();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await slugs.updateOne(
            { tenant_id: tenantId },
            { $set: { slug, enabled: data.enabled, updated_at: now }, $setOnInsert: { _id: prefixedId('qr_menu_slug'), created_at: now } },
            { upsert: true },
          );
          return context.json({ tenantId, slug, enabled: data.enabled });
        } catch (error) {
          if (!duplicateKey(error)) throw error;
          // Çakışma başka işletmenin slug'ındansa son söz tekil dizindir; aynı işletmenin yarışı yeniden denenir.
          const owner = await slugs.findOne({ slug });
          if (owner && owner.tenant_id !== tenantId) return fail(context, 409, 'SLUG_TAKEN', 'Bu adres başka bir işletmede kullanılıyor.');
        }
      }
      return fail(context, 409, 'SLUG_TAKEN', 'Adres şu anda atanamadı; tekrar deneyin.');
    });
  }
}
