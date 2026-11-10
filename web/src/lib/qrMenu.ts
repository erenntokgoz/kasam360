// kasam360.qrmenu.v1 genel okuma sözleşmesinin (docs/contracts/qr-menu.md) istemci tarafı tipleri ve doğrulaması.
// Sunucudan gelen gövdeye güvenilmez: biçim bozuksa sayfa yanlış fiyat göstermek yerine hata verir (fail-closed).

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  sortOrder: number;
  inStock: boolean;
  image: string | null;
}
export interface MenuCategory { id: string; name: string; sortOrder: number; products: MenuProduct[] }
export interface PublicMenu {
  slug: string;
  version: number;
  publishedAt: string;
  currency: string;
  /** Sözleşmede yoktur; ileride eklenirse gösterilir, yoksa adresten türetilir. */
  businessName: string | null;
  categories: MenuCategory[];
}

export type MenuResult =
  | { status: 'ok'; menu: PublicMenu }
  | { status: 'not-found' };

// Sözleşmedeki slug kuralı: 3-40 karakter, a-z 0-9 ve tire, baş/son tire ve ardışık tire yok.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !value.includes('--');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseProduct(value: unknown): MenuProduct {
  if (!isRecord(value)) throw new Error('Ürün biçimi geçersiz');
  const { id, name, description, priceCents, sortOrder, inStock, image } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || name.length === 0) throw new Error('Ürün kimliği veya adı geçersiz');
  if (typeof priceCents !== 'number' || !Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error('Ürün fiyatı geçersiz');
  if (typeof sortOrder !== 'number' || typeof inStock !== 'boolean') throw new Error('Ürün alanları geçersiz');
  if (description != null && typeof description !== 'string') throw new Error('Ürün açıklaması geçersiz');
  // Görsel yalnız aynı kaynaktaki görsel ucuna işaret edebilir; başka bir adres gelirse görsel hiç gösterilmez.
  const safeImage = typeof image === 'string' && /^\/public\/menu\/[a-z0-9-]+\/images\/[0-9a-f]{64}\.webp$/.test(image) ? image : null;
  return { id, name, description: description?.trim() ? description : null, priceCents, sortOrder, inStock, image: safeImage };
}

export function parsePublicMenu(value: unknown): PublicMenu {
  if (!isRecord(value) || value.schema !== 'kasam360.qrmenu.v1') throw new Error('Menü şeması tanınmıyor');
  const { slug, version, publishedAt, currency, categories, name } = value;
  if (typeof slug !== 'string' || typeof version !== 'number' || typeof publishedAt !== 'string' || typeof currency !== 'string' || !Array.isArray(categories)) {
    throw new Error('Menü alanları eksik');
  }
  const parsed: MenuCategory[] = categories.map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.sortOrder !== 'number' || !Array.isArray(raw.products)) {
      throw new Error('Kategori biçimi geçersiz');
    }
    return { id: raw.id, name: raw.name, sortOrder: raw.sortOrder, products: raw.products.map(parseProduct) };
  });
  return {
    slug,
    version,
    publishedAt,
    currency,
    businessName: typeof name === 'string' && name.trim() ? name.trim() : null,
    categories: parsed.filter((category) => category.products.length > 0),
  };
}

// "kafe-x" -> "Kafe X". İşletme adı sözleşmede olmadığı için başlık adresten türetilir.
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ');
}

export function displayName(menu: PublicMenu): string {
  return menu.businessName ?? titleFromSlug(menu.slug);
}

// Sunucu tarafı okuma. 30 sn önbellek sözleşmedeki Cache-Control ile aynıdır; 404 sade "bulunamadı"dır,
// diğer her durum (5xx, ağ, bozuk gövde) hata olarak yükselir ve son iyi sayfa korunur.
export async function fetchPublicMenu(slug: string): Promise<MenuResult> {
  if (!isValidSlug(slug)) return { status: 'not-found' };
  const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
  const response = await fetch(`${origin}/public/menu/${slug}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 30 },
  });
  if (response.status === 404) return { status: 'not-found' };
  if (!response.ok) throw new Error(`Menü okunamadı (${response.status})`);
  return { status: 'ok', menu: parsePublicMenu(await response.json()) };
}
