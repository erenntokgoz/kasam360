import { syncErrorText } from './syncError';

/**
 * Tükendi geçicidir, satış dışı kalıcıdır: kasiyer ürünü taslaktan çıkarmadan önce
 * hangisi olduğunu bilmelidir. Sunucu kodu ekranda gösterilmez.
 */
export function orderErrorText(error: unknown, consequence: string): string {
  const message = String(error);
  if (message.includes('PRODUCT_86D')) return `Taslakta tükenen ürün var: ${consequence}.`;
  if (message.includes('PRODUCT_INACTIVE')) return `Taslakta satış dışı ürün var: ${consequence}.`;
  return syncErrorText(error, consequence);
}
