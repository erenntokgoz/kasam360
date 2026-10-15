/**
 * Kuruş değerini para birimi formatına çevirir.
 * Para daima kuruş (INTEGER) olarak saklanır, float matematik yapılmaz.
 */
export function formatMoney(cents: number): string {
  const lira = cents / 100;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(lira);
}
