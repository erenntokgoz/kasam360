import { toLocalIso } from '../../lib/dateRange';

export type ClosedOrderSort = 'closed_desc' | 'closed_asc' | 'total_desc' | 'total_asc' | 'table_asc';
export type ClosedOrderMethod = '' | 'CASH' | 'CARD' | 'MEAL_CARD' | 'VERESIYE';

export interface ClosedOrderRow {
  orderId: string;
  tableName: string;
  guestCount: number;
  openedAt: string;
  closedAt: string;
  openedById: string | null;
  openedByName: string | null;
  closedById: string;
  closedByName: string | null;
  orderTotalCents: number;
  paidCents: number;
  cashCents: number;
  cardCents: number;
  mealCardCents: number;
  veresiyeCents: number;
  lastTransactionId: string;
}

export interface ClosedOrderList {
  rows: ClosedOrderRow[];
  summary: { count: number; paidCents: number };
}

export interface ClosedOrderDetail {
  header: ClosedOrderRow;
  items: { productName: string; quantity: number; totalCents: number; isComp: boolean; voided: boolean }[];
  payments: { transactionId: string; method: string; amountCents: number; actorName: string | null; paidAt: string }[];
  refunds: { amountCents: number; method: string; reason: string; actorName: string | null; createdAt: string }[];
  voids: { kind: 'ORDER' | 'ITEM'; reason: string; amountCents: number; actorName: string | null; createdAt: string }[];
}

export interface ClosedOrderQuery {
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
  method: ClosedOrderMethod;
  tableSearch: string;
  openedBy: string;
  closedBy: string;
  sort: ClosedOrderSort;
}

export const METHOD_OPTIONS: { value: ClosedOrderMethod; label: string }[] = [
  { value: '', label: 'Tüm yöntemler' },
  { value: 'CASH', label: 'Nakit' },
  { value: 'CARD', label: 'Kredi kartı' },
  { value: 'MEAL_CARD', label: 'Yemek kartı' },
  { value: 'VERESIYE', label: 'Veresiye' },
];

export const SORT_OPTIONS: { value: ClosedOrderSort; label: string }[] = [
  { value: 'closed_desc', label: 'Kapanış: yeni önce' },
  { value: 'closed_asc', label: 'Kapanış: eski önce' },
  { value: 'total_desc', label: 'Tutar: çoktan aza' },
  { value: 'total_asc', label: 'Tutar: azdan çoğa' },
  { value: 'table_asc', label: 'Masa adı' },
];

const two = (value: number) => String(value).padStart(2, '0');

export function dayText(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Takvim gününü kaydırır; gece yarısı ve ay sonu sınırlarını Date hesaplar. */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return dayText(new Date(year, month - 1, date + delta));
}

export function defaultQuery(now = new Date()): ClosedOrderQuery {
  const today = dayText(now);
  return { fromDate: today, fromTime: '00:00', toDate: today, toTime: '23:59', method: '', tableSearch: '', openedBy: '', closedBy: '', sort: 'closed_desc' };
}

/** Önceki/Sonraki gün: iki uç da aynı gün sayısı kadar kayar, saatler korunur. */
export function moveQuery(query: ClosedOrderQuery, delta: number): ClosedOrderQuery {
  return { ...query, fromDate: shiftDay(query.fromDate, delta), toDate: shiftDay(query.toDate, delta) };
}

function localInstant(day: string, time: string, endOfMinute: boolean): string | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;
  return toLocalIso(new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]), hour, minute, endOfMinute ? 59 : 0));
}

/** Tarih-saat aralığını yerel ofsetli ISO uçlarına çevirir; geçersiz veya ters aralıkta hata metni döner. */
export function queryRange(query: ClosedOrderQuery): { from: string; to: string } | { error: string } {
  const from = localInstant(query.fromDate, query.fromTime, false);
  const to = localInstant(query.toDate, query.toTime, true);
  if (!from || !to) return { error: 'Başlangıç ve bitiş tarih-saatini girin.' };
  if (Date.parse(to) < Date.parse(from)) return { error: 'Başlangıç bitişten sonra olamaz.' };
  return { from, to };
}

/** Sunucu filtresi; boş alanlar hiç gönderilmez. */
export function buildFilter(query: ClosedOrderQuery, range: { from: string; to: string }, offset: number, limit: number) {
  return {
    ...range,
    method: query.method || null,
    tableSearch: query.tableSearch.trim() || null,
    openedBy: query.openedBy || null,
    closedBy: query.closedBy || null,
    sort: query.sort,
    limit,
    offset,
  };
}

export function methodSummary(row: Pick<ClosedOrderRow, 'cashCents' | 'cardCents' | 'mealCardCents' | 'veresiyeCents'>): string {
  const parts: string[] = [];
  if (row.cashCents > 0) parts.push('Nakit');
  if (row.cardCents > 0) parts.push('Kart');
  if (row.mealCardCents > 0) parts.push('Yemek kartı');
  if (row.veresiyeCents > 0) parts.push('Veresiye');
  return parts.join(' + ') || 'Belirtilmemiş';
}
