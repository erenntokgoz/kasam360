import { localDate } from './cariInput';
import type { ReceiptInput, Settlement } from '../types/stock';

export type ReceiptMode = 'TERM' | 'PAID';
export type PaidChannel = Exclude<Settlement, 'TERM'>;

/** Ekrandaki ham giriş; sayılar yazıldığı gibi tutulur, gönderirken çözülür. */
export interface ReceiptDraft {
  mode: ReceiptMode;
  channel: PaidChannel;
  dueDate: string;
  documentNo: string;
  grams: Record<string, string>;
}

export const emptyReceiptDraft = (now = new Date()): ReceiptDraft => ({
  mode: 'TERM',
  channel: 'CASH',
  dueDate: localDate(now),
  documentNo: '',
  grams: {},
});

export const PAID_CHANNELS: { id: PaidChannel; label: string }[] = [
  { id: 'CASH', label: 'Nakit' },
  { id: 'CREDIT_CARD', label: 'Kart' },
  { id: 'BANK_TRANSFER', label: 'Havale' },
];

/**
 * Gram yalnız adetle alınan kalemde anlamlıdır; boş bırakılan kalem adet olarak
 * stoğa girer. Vade yalnız vadeli alımda gider: boşsa sunucu tedarikçi vadesini kullanır.
 */
export function toReceiptInput(draft: ReceiptDraft, gramProductIds: string[]): ReceiptInput {
  const usableGrams = gramProductIds.flatMap((productId) => {
    const text = (draft.grams[productId] ?? '').trim();
    if (!text) return [];
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) throw new Error('Kullanılabilir gram sıfırdan büyük olmalı.');
    return [{ productId, usableGramsPerUnit: value }];
  });
  if (draft.mode === 'TERM' && draft.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) {
    throw new Error('Vade tarihi geçersiz.');
  }
  return {
    settlement: draft.mode === 'TERM' ? 'TERM' : draft.channel,
    dueDate: draft.mode === 'TERM' && draft.dueDate ? draft.dueDate : null,
    documentNo: draft.documentNo.trim() || null,
    usableGrams,
  };
}

/** Aynı sipariş aynı seçimlerle yeniden denenirse aynı işlem kimliği kullanılır. */
export function receiptKey(orderId: string, input: ReceiptInput): string {
  return JSON.stringify([orderId, input.settlement, input.dueDate, input.documentNo, input.usableGrams]);
}
