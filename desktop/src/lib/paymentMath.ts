import type { PaymentSplitMode } from '../types/payment';

export interface PaymentPlanInput {
  mode: PaymentSplitMode;
  remainingCents: number;
  itemsCents: number;
  /** Tutara Göre alanı; boşsa `null`. */
  partialCents: number | null;
  /** Alınan nakit alanı; boşsa `null`. */
  receivedCents: number | null;
  isCash: boolean;
}

export interface PaymentPlan {
  dueCents: number;
  receivedCents: number;
  changeCents: number;
  shortCents: number;
  /** Bu tahsilattan sonra masada kalacak tutar. Para üstüyle karışmaz. */
  leftCents: number;
  exceedsRemaining: boolean;
}

/**
 * Ödemenin tek hesabı. Tutara Göre'de nakit fazlası kaybolmaz: kalandan büyük tutar para üstü
 * doğurur, tutar boşsa müşterinin verdiği nakit kadar tahsil edilir.
 */
export function planPayment(input: PaymentPlanInput): PaymentPlan {
  const { mode, remainingCents, itemsCents, partialCents, receivedCents, isCash } = input;
  const asked = partialCents ?? (isCash ? receivedCents : null) ?? 0;
  const dueCents = mode === 'FULL' ? remainingCents : mode === 'ITEMS' ? itemsCents : Math.min(asked, remainingCents);
  const exceedsRemaining = !isCash && mode === 'PARTIAL' && asked > remainingCents;
  const tendered = isCash ? receivedCents ?? (mode === 'PARTIAL' ? Math.max(asked, dueCents) : dueCents) : dueCents;
  return {
    dueCents,
    receivedCents: tendered,
    changeCents: Math.max(0, tendered - dueCents),
    shortCents: Math.max(0, dueCents - tendered),
    leftCents: Math.max(0, remainingCents - dueCents),
    exceedsRemaining,
  };
}
