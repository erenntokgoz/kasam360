// Ana sayfa sahnesindeki örnek sipariş: Masa 12. Tutarlar kuruş tamsayısıdır ve tek yerden gelir;
// 3D sahne ile altındaki metinler aynı sayıları kullanır, toplam tutmazsa modül yüklenmez.
const base = { qty: 4, unitCents: 12_500, cashCents: 20_000, cardCents: 30_000, lotA: [2, 200] as const, lotB: [2, 500] as const };
const totalCents = base.qty * base.unitCents;
const costCents = base.lotA[0] * base.lotA[1] + base.lotB[0] * base.lotB[1];
if (base.cashCents + base.cardCents !== totalCents) throw new Error('Örnek siparişin toplamı tutmuyor');

export const ORDER_FIXTURE = { ...base, totalCents, costCents };
