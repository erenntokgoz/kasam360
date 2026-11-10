// Slug'ı yalnız Labs yöneticisi atar; biçim ve rezerve ad kuralı Labs'ta da aynen uygulanır (iki yerde savunma).

export const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Rezerve adlar: alt alan, yönetim ve kimlik karışıklığı yaratabilecek her ad.
const RESERVED = new Set([
  'www', 'api', 'admin', 'menu', 'labs', 'app', 'mail', 'smtp', 'imap', 'ftp', 'web', 'panel', 'portal', 'desk',
  'kasam', 'kasam360', '360labs', 'support', 'destek', 'login', 'giris', 'kayit', 'static', 'assets', 'cdn',
  'status', 'health', 'public', 'internal', 'test', 'dev', 'staging', 'demo',
]);

export type SlugCheck = 'ok' | 'invalid' | 'reserved';

export function checkSlug(value: unknown): SlugCheck {
  // "--" ve "xn-" öneki punycode benzeri adlarla karıştırmayı önler.
  if (typeof value !== 'string' || !SLUG.test(value) || value.includes('--') || value.startsWith('xn-')) return 'invalid';
  return RESERVED.has(value) ? 'reserved' : 'ok';
}
