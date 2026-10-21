/**
 * Kuruş değerini yerelleştirilmiş para formatına çevirir (Örn: 1.250,50 ₺).
 * Tüm para birimleri veri tabanında, servislerde ve IPC kontratlarında tamsayı kuruş (INTEGER)
 * olarak saklanır. Finansal hesaplamalarda float kullanımı kesinlikle yasaktır.
 */
export function formatMoney(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  const isNegative = safeCents < 0;
  const absCents = Math.abs(safeCents);
  const liras = Math.floor(absCents / 100);
  const kurus = absCents % 100;

  const formattedLira = liras.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formattedKurus = kurus.toString().padStart(2, '0');

  const sign = isNegative ? '-' : '';
  return `${sign}${formattedLira},${formattedKurus} ₺`;
}
