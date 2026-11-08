// Tutarlar kuruş tamsayısı olarak gelir; ondalık hesap yapılmadığı için yuvarlama kayması oluşmaz.
// Para birimi yazılmayan yerler (fiş satırı, ekran sütunu) aynı kuralı formatMoneyAmount ile kullanır.
export function formatMoneyAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const lira = Math.floor(absolute / 100).toLocaleString('tr-TR');
  const kurus = String(absolute % 100).padStart(2, '0');
  return `${sign}${lira},${kurus}`;
}

export function formatMoney(cents: number): string {
  return `${formatMoneyAmount(cents)} TL`;
}
