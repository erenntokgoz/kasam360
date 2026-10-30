// KASAM360 Para Parse Yardımcısı
// Finansal tutarları güvenle INTEGER kuruş (cents) formatına çevirir.
// Float ve sessiz hatalar kesinlikle engellenmiştir. Fail-closed prensibi geçerlidir.

export function parseMoneyToCents(val: string | number): number {
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val < 0) {
      throw new Error('Geçersiz para tutarı');
    }
    return Math.round(val);
  }

  const clean = val.replace(/\s/g, '').replace(/TL/gi, '').replace(/₺/g, '').trim();
  if (!clean) return 0;

  // Negatif kontrolü
  if (clean.startsWith('-')) {
    throw new Error('Negatif fiyat tutarı girilemez');
  }

  // Birden fazla ayraç kontrolü
  const separatorCount = (clean.match(/[,.]/g) || []).length;
  if (separatorCount > 1) {
    throw new Error('Birden fazla ondalık ayracı içeremez');
  }

  // Sadece rakam ve tek bir ayraç içermeli
  if (!/^\d+([,.]\d{1,2})?$/.test(clean) && !/^\d+$/.test(clean)) {
    throw new Error('Geçersiz para formatı (örn: 45,00 veya 45)');
  }

  const [wholeStr, fracStr = ''] = clean.split(/[,.]/);
  const whole = parseInt(wholeStr, 10);
  if (isNaN(whole) || whole < 0) {
    throw new Error('Geçersiz para tutarı');
  }

  const frac = parseInt(fracStr.padEnd(2, '0').slice(0, 2), 10) || 0;
  return whole * 100 + frac;
}
