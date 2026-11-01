/** Sayı alanlarının ortak kuralı. Durumda ham metin ("1234,5") tutulur, ekranda gruplanır. */
export type NumberKind = 'money' | 'quantity' | 'integer' | 'digits';

const DECIMALS: Record<NumberKind, number> = { money: 2, quantity: 3, integer: 0, digits: 0 };
const MAX_WHOLE_DIGITS = 12;

/** Yazılanı ham metne indirir: harf girmez, binlik noktası atılır, sondaki nokta virgül sayılır. */
export function toRawNumber(text: string, kind: NumberKind): string {
  if (kind === 'digits') return text.replace(/\D/g, '');
  const decimals = DECIMALS[kind];
  const compact = text.replace(/\s|₺/g, '');
  if (decimals === 0) return compact.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_WHOLE_DIGITS);
  const withComma = compact.endsWith('.') && !compact.includes(',') ? `${compact.slice(0, -1)},` : compact;
  const [wholeText, ...rest] = withComma.replace(/[^\d,]/g, '').split(',');
  const whole = wholeText.replace(/^0+(?=\d)/, '').slice(0, MAX_WHOLE_DIGITS);
  if (rest.length === 0) return whole;
  return `${whole || '0'},${rest.join('').slice(0, decimals)}`;
}

/** Ham metni 1.234.567,50 biçiminde gösterir. */
export function groupNumber(raw: string): string {
  const [whole, fraction] = raw.replace('.', ',').split(',');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/** Yüzde metnini baz puana çevirir: "12,5" → 1250. Geçersiz metin `null` döner. */
export function parsePercentBp(raw: string): number | null {
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Toplu zamda arka uçla aynı tam sayı yuvarlaması: önizleme uygulanan fiyatla ayrışmaz. */
export function applyPercentBp(cents: number, percentBp: number): number {
  const scaled = cents * (10_000 + percentBp) + 5_000;
  return (scaled - (scaled % 10_000)) / 10_000;
}

/** Sayaç ve adetleri gösterir: 123.456.789 */
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('tr-TR') : '-';
}
