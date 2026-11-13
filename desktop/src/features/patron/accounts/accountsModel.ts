export type AccountKind = 'CASH' | 'BANK' | 'POS';

export interface MoneyAccount {
  id: string;
  name: string;
  kind: AccountKind;
  openingCents: number;
  balanceCents: number;
  isActive: boolean;
}

export interface FlowEntry {
  id: string;
  kind: 'CASH_IN' | 'CASH_OUT' | 'TRANSFER';
  amountCents: number;
  description: string;
  actorName: string | null;
  createdAt: string;
}

export const KIND_LABEL: Record<AccountKind, string> = { CASH: 'Kasa', BANK: 'Banka', POS: 'POS' };

export const FLOW_LABEL: Record<FlowEntry['kind'], string> = { CASH_IN: 'Nakit giriş', CASH_OUT: 'Nakit çıkış', TRANSFER: 'Transfer' };

/** Transfer formu doğrulaması: kaynak bakiyesini aşan veya aynı hesaba giden tutar gönderilmez. */
export function transferProblem(from: MoneyAccount | undefined, to: MoneyAccount | undefined, cents: number | null): string | null {
  if (!from || !to) return 'Kaynak ve hedef hesabı seçin.';
  if (from.id === to.id) return 'Kaynak ve hedef hesap aynı olamaz.';
  if (cents === null || cents <= 0) return 'Tutarı girin.';
  if (cents > from.balanceCents) return 'Kaynak hesap bakiyesi yetersiz.';
  return null;
}
