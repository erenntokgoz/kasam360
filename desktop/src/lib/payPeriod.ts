export type PayPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const PAY_PERIODS: { id: PayPeriod; label: string; amountLabel: string }[] = [
  { id: 'DAILY', label: 'Günlük', amountLabel: 'Günlük Ücret' },
  { id: 'WEEKLY', label: 'Haftalık', amountLabel: 'Haftalık Ücret' },
  { id: 'MONTHLY', label: 'Aylık', amountLabel: 'Aylık Maaş' },
];

export const amountLabelOf = (period: PayPeriod) => PAY_PERIODS.find((item) => item.id === period)?.amountLabel ?? 'Aylık Maaş';

const two = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
const dayLabel = (date: Date) => `${two(date.getDate())}.${two(date.getMonth() + 1)}`;
const shifted = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export interface PeriodOption {
  key: string;
  label: string;
}

/** Hesaplanabilecek son dönemler, en yenisi önce. Hafta pazartesi başlar. */
export function recentPeriods(kind: PayPeriod, now = new Date()): PeriodOption[] {
  if (kind === 'DAILY') {
    return Array.from({ length: 7 }, (_, back) => {
      const date = shifted(now, -back);
      return { key: dayKey(date), label: dayLabel(date) };
    });
  }
  if (kind === 'WEEKLY') {
    const monday = shifted(now, -((now.getDay() + 6) % 7));
    return Array.from({ length: 4 }, (_, back) => {
      const start = shifted(monday, -7 * back);
      return { key: dayKey(start), label: `${dayLabel(start)} - ${dayLabel(shifted(start, 6))}` };
    });
  }
  return Array.from({ length: 3 }, (_, back) => {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
    return { key, label: key };
  });
}
