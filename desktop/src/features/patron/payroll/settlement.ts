import { parseCents } from '../../../lib/moneyInput';

export type PayMethod = 'CASH' | 'BANK_TRANSFER';

/** Tutar alanları `null` ise çağıran tutarı göremiyor; sıfır gibi gösterilmez. */
export interface StaffSettlement {
  id: string;
  userId: string;
  fullName: string;
  workSessionId: string;
  workDate: string;
  kind: 'HOURLY' | 'DAILY';
  workedSeconds: number;
  rateCents: number | null;
  earnedCents: number | null;
  paidCents: number | null;
  remainingCents: number | null;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  createdAt: string;
}

export interface SessionSettlement {
  settlement: StaffSettlement | null;
  note: string | null;
}

export interface StaffDebt {
  userId: string;
  fullName: string;
  openCount: number;
  remainingCents: number | null;
}

export const STATUS_LABEL: Record<StaffSettlement['status'], string> = {
  UNPAID: 'Ödenmedi',
  PARTIAL: 'Kısmi ödendi',
  PAID: 'Ödendi',
};

export const METHOD_LABEL: Record<PayMethod, string> = { CASH: 'Nakit', BANK_TRANSFER: 'Havale' };

/** Ödeme tutarı kalan borcu aşamaz ve sıfır olamaz; hata metni boşsa tutar geçerlidir. */
export function checkPayAmount(text: string, remainingCents: number): { cents: number | null; error: string | null } {
  const cents = parseCents(text);
  if (cents === null) return { cents: null, error: 'Tutarı rakamla yazın.' };
  if (cents <= 0) return { cents: null, error: 'Tutar sıfırdan büyük olmalı.' };
  if (cents > remainingCents) return { cents: null, error: 'Tutar kalan borcu aşıyor.' };
  return { cents, error: null };
}

/** Giriş-çıkış arası net saniye (mola düşülmüş); sunucu kuralıyla aynı: çıkış girişten sonra, ≤ 24 saat. */
export function netWorkedSeconds(startedAt: string, endedAt: Date, breakMinutes: number): number | null {
  const start = new Date(startedAt).getTime();
  const total = Math.floor((endedAt.getTime() - start) / 1000);
  if (!Number.isFinite(total) || total <= 0 || total > 24 * 3600) return null;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes * 60 > total) return null;
  return total - breakMinutes * 60;
}
