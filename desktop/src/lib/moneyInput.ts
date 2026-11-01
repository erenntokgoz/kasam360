/** Kuruşu giriş alanının ham metnine çevirir; kayan nokta kullanılmaz. */
export function centsToText(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

/** Lira metnini kuruşa çevirir; kayan nokta kullanılmaz. Geçersiz girişte `null` döner. */
export function parseCents(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
