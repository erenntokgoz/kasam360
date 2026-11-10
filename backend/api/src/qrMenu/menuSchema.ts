import { createHash } from 'node:crypto';

export const MENU_SCHEMA = 'kasam360.qrmenu.v1';

export interface MenuCategory { id: string; name: string; sortOrder: number }
export interface MenuProduct {
  id: string; name: string; description: string | null; priceCents: number; categoryId: string;
  sortOrder: number; imageKey: string | null; active: boolean; inStock: boolean;
}
export interface MenuSnapshot { businessName: string | null; categories: MenuCategory[]; products: MenuProduct[] }

export class MenuInvalid extends Error {
  constructor(public readonly field: string) {
    super(field);
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_KEY = /^[0-9a-f]{64}$/;
const MAX_CATEGORIES = 100;
const MAX_PRODUCTS = 2000;
const MAX_PRICE_CENTS = 10_000_000;
const MAX_SORT = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function exact(value: Record<string, unknown>, keys: string[], field: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new MenuInvalid(`${field}.${key}`);
}

function text(value: unknown, max: number, field: string) {
  if (typeof value !== 'string') throw new MenuInvalid(field);
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > max) throw new MenuInvalid(field);
  return trimmed;
}

function integer(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new MenuInvalid(field);
  return value;
}

/** Yayın gövdesini doğrular; ihlalde alan yolu ile birlikte fırlatır. Para yalnız tamsayı kuruştur. */
export function parseMenu(input: unknown): MenuSnapshot {
  if (!isRecord(input)) throw new MenuInvalid('body');
  exact(input, ['schema', 'businessName', 'categories', 'products'], 'body');
  if (input.schema !== MENU_SCHEMA) throw new MenuInvalid('schema');
  if (!Array.isArray(input.categories) || input.categories.length > MAX_CATEGORIES) throw new MenuInvalid('categories');
  if (!Array.isArray(input.products) || input.products.length > MAX_PRODUCTS) throw new MenuInvalid('products');
  const categoryIds = new Set<string>();
  const categories = input.categories.map((raw: unknown, index): MenuCategory => {
    const field = `categories[${index}]`;
    if (!isRecord(raw)) throw new MenuInvalid(field);
    exact(raw, ['id', 'name', 'sortOrder'], field);
    if (typeof raw.id !== 'string' || !ID.test(raw.id) || categoryIds.has(raw.id)) throw new MenuInvalid(`${field}.id`);
    categoryIds.add(raw.id);
    return { id: raw.id, name: text(raw.name, 80, `${field}.name`), sortOrder: integer(raw.sortOrder, 0, MAX_SORT, `${field}.sortOrder`) };
  });
  const productIds = new Set<string>();
  const products = input.products.map((raw: unknown, index): MenuProduct => {
    const field = `products[${index}]`;
    if (!isRecord(raw)) throw new MenuInvalid(field);
    exact(raw, ['id', 'name', 'description', 'priceCents', 'categoryId', 'sortOrder', 'imageKey', 'active', 'inStock'], field);
    if (typeof raw.id !== 'string' || !ID.test(raw.id) || productIds.has(raw.id)) throw new MenuInvalid(`${field}.id`);
    productIds.add(raw.id);
    if (typeof raw.categoryId !== 'string' || !categoryIds.has(raw.categoryId)) throw new MenuInvalid(`${field}.categoryId`);
    if (typeof raw.active !== 'boolean') throw new MenuInvalid(`${field}.active`);
    if (typeof raw.inStock !== 'boolean') throw new MenuInvalid(`${field}.inStock`);
    const description = raw.description === undefined || raw.description === null ? null : text(raw.description, 1000, `${field}.description`);
    const imageKey = raw.imageKey === undefined || raw.imageKey === null ? null : raw.imageKey;
    if (imageKey !== null && (typeof imageKey !== 'string' || !IMAGE_KEY.test(imageKey))) throw new MenuInvalid(`${field}.imageKey`);
    return {
      id: raw.id, name: text(raw.name, 120, `${field}.name`), description,
      priceCents: integer(raw.priceCents, 0, MAX_PRICE_CENTS, `${field}.priceCents`),
      categoryId: raw.categoryId, sortOrder: integer(raw.sortOrder, 0, MAX_SORT, `${field}.sortOrder`),
      imageKey, active: raw.active, inStock: raw.inStock,
    };
  });
  const businessName = input.businessName === undefined || input.businessName === null ? null : text(input.businessName, 120, 'businessName');
  return { businessName, categories, products };
}

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = <T extends { sortOrder: number; id: string }>(items: T[]) =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder || compareId(a.id, b.id));

/** Aynı içerik her zaman aynı etag'i verir: sıra ve anahtar düzeni sabitlenir. */
export function canonicalMenu(menu: MenuSnapshot): MenuSnapshot {
  return {
    businessName: menu.businessName ?? null,
    categories: order(menu.categories).map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    products: order(menu.products).map(({ id, name, description, priceCents, categoryId, sortOrder, imageKey, active, inStock }) => (
      { id, name, description, priceCents, categoryId, sortOrder, imageKey, active, inStock }
    )),
  };
}

export const menuEtag = (menu: MenuSnapshot) =>
  `"sha256-${createHash('sha256').update(JSON.stringify(canonicalMenu(menu))).digest('hex')}"`;
