import type { OrderItem, OrderItemModifier } from '../types/pos';

// Sunucu adisyonunun istemcideki görünümü. Hesaplar backend ile aynı tamsayı
// kuruş kurallarını izler; kesin tutar yine sunucudan gelir.

export interface CartItemWire {
  id: string;
  product: { id: string; name: string };
  quantity: number;
  unitPrice: number;
  taxRate?: number | null;
  taxAmount?: number | null;
  total?: number | null;
  modifiers?: { id: string; name: string; priceCents: number }[] | null;
  note?: string | null;
  paidQuantity?: number | null;
  isComp?: boolean | null;
  courseNumber?: number | null;
  status?: string | null;
}

/** Satır toplamı: KDV tabanı üzerinden aşağı yuvarlanır (`execute_submit_order`). */
export function lineTotalCents(unitPriceCents: number, quantity: number, taxRateBp: number): number {
  const subtotal = unitPriceCents * quantity;
  return subtotal + Math.floor((subtotal * taxRateBp) / 10_000);
}

/** Adetin payı kümülatif türetilir; üç adetlik satır tek tek ödenince kuruş kaybolmaz. */
export function unitShareCents(item: OrderItem, quantity: number): number {
  const lineQuantity = item.lineQuantity ?? item.quantity;
  const lineTotal = item.lineTotalCents ?? item.totalCents;
  const paid = item.paidQuantity ?? 0;
  const upto = (count: number) => Math.floor((lineTotal * count) / lineQuantity);
  return upto(paid + quantity) - upto(paid);
}

function mapModifiers(modifiers: CartItemWire['modifiers']): OrderItemModifier[] {
  return (modifiers ?? []).map((m) => ({ optionId: m.id, name: m.name, priceDeltaCents: m.priceCents }));
}

/** Ödenmiş adetler adisyondan düşer; tamamı ödenen satır görünmez. */
export function mapServerItem(wire: CartItemWire): OrderItem | null {
  const paid = wire.paidQuantity ?? 0;
  const remaining = wire.quantity - paid;
  if (remaining <= 0) return null;
  const lineTotal = wire.total ?? 0;
  const base: OrderItem = {
    id: wire.id,
    productId: wire.product.id,
    name: wire.product.name,
    quantity: remaining,
    unitPriceCents: wire.unitPrice,
    vatRate: (wire.taxRate ?? 0) / 100,
    taxRateBp: wire.taxRate ?? 0,
    station: 'MUTFAK',
    course: ((wire.courseNumber ?? 1) as 1 | 2 | 3),
    notes: wire.note ?? undefined,
    selectedModifiers: mapModifiers(wire.modifiers),
    totalCents: 0,
    isSentToKitchen: true,
    isComp: !!wire.isComp,
    lineQuantity: wire.quantity,
    paidQuantity: paid,
    lineTotalCents: lineTotal,
  };
  return { ...base, totalCents: unitShareCents(base, remaining) };
}

/** KDV payı yaklaşık değildir: satırın sunucu payından orantılanır. */
export function itemTaxCents(item: OrderItem): number {
  const rate = item.taxRateBp ?? 0;
  return item.totalCents - Math.floor((item.totalCents * 10_000) / (10_000 + rate));
}

/** Mutfağa gidecek kalemin sunucu sözleşmesi. Fiyat gönderilmez, sunucu hesaplar. */
export function toSubmitItem(item: OrderItem) {
  const degree = item.cookingDegree ? [item.cookingDegree] : [];
  const note = [...degree, ...(item.notes ? [item.notes] : [])].join(' · ');
  return {
    id: item.id,
    product: { id: item.productId },
    quantity: item.quantity,
    modifiers: item.selectedModifiers.map((m) => ({ id: m.optionId })),
    note: note || null,
    courseNumber: item.course,
  };
}
