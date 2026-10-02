import type { ShiftHistoryDto, OpenShiftDto } from './types';

// AGENTS.md Finansal Kuralı: Tutar hesaplamaları tam sayı kuruş (cents) formatındadır
export const formatCurrency = (cents: number | undefined | null) => {
  const safeCents = typeof cents === 'number' && !isNaN(cents) ? cents : 0;
  return (safeCents / 100).toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  });
};

// Tarih ve saat formatlayıcı
export const formatDateTime = (dateStr: string | undefined | null) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

// Takvim günü karşılaştırma yardımcısı
export const isSameCalendarDay = (dateStr: string | undefined | null) => {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
};

// Backend DTO alan uyumluluk yardımcıları (camelCase ve snake_case desteği)
export const getOpenedAt = (s: ShiftHistoryDto | OpenShiftDto) => s.opened_at || s.openedAt || '';
export const getClosedAt = (s: ShiftHistoryDto) => s.closed_at || s.closedAt || null;
export const getCashierId = (s: ShiftHistoryDto | OpenShiftDto) => s.cashier_id || s.cashierId || 'Kasiyer';
export const getCashierName = (s: ShiftHistoryDto | OpenShiftDto) =>
  s.cashierName || s.cashier_name || getCashierId(s);

export const getExpectedCents = (s: ShiftHistoryDto | OpenShiftDto) =>
  'expected_amount_cents' in s && typeof s.expected_amount_cents === 'number'
    ? s.expected_amount_cents
    : 'expectedAmountCents' in s && typeof s.expectedAmountCents === 'number'
    ? s.expectedAmountCents
    : 'openingBalance' in s && typeof s.openingBalance === 'number'
    ? s.openingBalance
    : 0;

export const getActualCents = (s: ShiftHistoryDto) => s.actual_amount_cents ?? s.actualAmountCents ?? null;
export const getDifferenceCents = (s: ShiftHistoryDto) => s.difference_cents ?? s.differenceCents ?? null;
