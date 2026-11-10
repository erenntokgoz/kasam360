import { isValidSlug } from '@/lib/qrMenu';

// menu.* alt alanındaki istekleri menü rotasına eşler. Menü alt alanı yalnız /{slug} ve genel menü ucunu
// (görseller) sunar; ana sitenin sayfaları bu alan adından açılmaz.
const PASS_PREFIXES = ['/_next/', '/public/menu/'];
const PASS_FILES = new Set(['/favicon.ico', '/apple-icon.png', '/robots.txt']);

export function isMenuHost(host: string | null): boolean {
  const name = (host ?? '').split(':')[0].toLowerCase();
  return name.startsWith('menu.');
}

/** Yeniden yazılacak yolu döner; null ise istek olduğu gibi geçer. */
export function resolveMenuHostRewrite(host: string | null, pathname: string): string | null {
  if (!isMenuHost(host)) return null;
  if (PASS_FILES.has(pathname) || PASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 && isValidSlug(segments[0])) return `/m/${segments[0]}`;
  // Kök ve tanınmayan yollar menü bulunamadı sayfasına düşer; ana site sayfaları sızmaz.
  return '/m/-';
}
