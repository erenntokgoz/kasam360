/**
 * Bahşiş yüzdeleri çarpanlardan türetilir: pay çarpanla orantılıdır, toplam tam 100 olur.
 * En büyük kalan yöntemi kullanılır; eşit kalanda listedeki sıra kazanır ki aynı
 * çarpanlarla her açılışta aynı yüzdeler çıksın.
 */
export function sharesFromMultipliers(members: { id: string; multiplier: number }[]): Record<string, number> {
  const valid = members.filter((member) => Number.isInteger(member.multiplier) && member.multiplier > 0);
  const total = valid.reduce((sum, member) => sum + member.multiplier, 0);
  if (total === 0) return {};
  const rows = valid.map((member, index) => ({
    id: member.id,
    index,
    share: Math.floor((member.multiplier * 100) / total),
    remainder: (member.multiplier * 100) % total,
  }));
  let missing = 100 - rows.reduce((sum, row) => sum + row.share, 0);
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const row of order) {
    if (missing === 0) break;
    row.share += 1;
    missing -= 1;
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.share]));
}

/** Kuralı olmayan kişi veritabanı varsayılanıyla (100 = 1,00) sayılır. */
export const DEFAULT_TIP_MULTIPLIER = 100;
