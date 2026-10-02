//! Faz 11 tipleri (TypeScript tarafı).
//!
//! Backend `staff_types.rs` ve `payroll_types.rs` ile birebir aynı alan adları
//! kullanır (camelCase). Ayrı tip tanımları kasten yok: iki taraf ayrışırsa
//! mock gerçeği göstermeyi bırakır.

export type StaffRole = 'MASTER' | 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export type StaffProfile = {
  userId: string;
  fullName: string;
  role: StaffRole | string;
  /** Müdüre `0` döner; asıl değer yalnız sahibe gider. */
  baseSalaryCents: number;
  commissionPercent: number;
  birthDate: string | null;
  hireDate: string | null;
  phone: string | null;
  nationalId: string | null;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
};

export type StaffProfileInput = {
  userId: string;
  fullName: string;
  baseSalaryCents: number;
  commissionPercent: number;
  birthDate?: string | null;
  hireDate?: string | null;
  phone?: string | null;
  nationalId?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  notes?: string | null;
};

export type PayrollModel = 'FIXED' | 'COMMISSION' | 'TIP' | 'HOURLY' | 'PROFIT_SHARE';

export type PayrollRule = {
  userId: string;
  fullName: string;
  model: PayrollModel | string;
  baseSalaryCents: number;
  commissionPercent: number;
  hourlyRateCents: number;
  tipMultiplierPercent: number;
  profitSharePercent: number;
  active: boolean;
};

export type PayrollRuleInput = {
  userId: string;
  model: PayrollModel | string;
  baseSalaryCents: number;
  commissionPercent: number;
  hourlyRateCents: number;
  tipMultiplierPercent: number;
  profitSharePercent: number;
};

export type PayrollAmounts = {
  baseCents: number;
  commissionCents: number;
  tipCents: number;
  hourlyCents: number;
  profitShareCents: number;
  deductionCents: number;
  grossCents: number;
  netCents: number;
};

export type PayrollRun = {
  id: string;
  userId: string;
  fullName: string;
  role: string;
  period: string;
  model: PayrollModel | string;
  /** `null` = çağıran tutarı göremiyor (müdür). 0 değil. */
  amounts: PayrollAmounts | null;
  basisNote: string;
  warning: string | null;
};

export type TipAllocation = {
  userId: string;
  fullName: string;
  basisCents: number;
  multiplierPercent: number;
  amountCents: number;
};

export type TipAllocationInput = {
  userId: string;
  basisCents: number;
  multiplierPercent: number;
};

export type TipPoolSummary = {
  period: string;
  totalCents: number;
  distributedCents: number;
  entryCount: number;
  /** Sıfır olmalıdır; değilse kırmızı uyarı gösterilir. */
  leftoverCents: number;
};

export type ShiftPlan = {
  id: string;
  userId: string;
  userName: string;
  planDate: string;
  startTime: string;
  endTime: string;
  plannedBreakMinutes: number;
  roleRequired: string;
  station: string | null;
  status: string;
  realizedShiftId: string | null;
};

export type ShiftPlanInput = {
  userId: string;
  planDate: string;
  startTime: string;
  endTime: string;
  plannedBreakMinutes: number;
  roleRequired: string;
  station?: string | null;
};

export type LeaveRequest = {
  id: string;
  userId: string;
  kind: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  approverId: string | null;
  decidedAt: string | null;
};

export type LeaveInput = {
  userId: string;
  kind: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
};

export type CustodyRecord = {
  id: string;
  userId: string;
  itemName: string;
  quantity: number;
  status: string;
  deliveredAt: string;
  returnedAt: string | null;
  notes: string | null;
};

export type StaffIncident = {
  id: string;
  userId: string;
  kind: string;
  severity: string;
  occurredAt: string;
  summary: string;
  details: string | null;
  resolution: string | null;
  status: string;
  recordedBy: string;
};

export type StaffIncidentInput = {
  userId: string;
  kind: string;
  severity: string;
  occurredAt: string;
  summary: string;
  details?: string | null;
};

export type StaffKpi = {
  userId: string;
  fullName: string;
  orderCount: number;
  itemCount: number;
  grossSalesCents: number;
  avgTicketCents: number;
  voidCount: number;
  topProduct: string | null;
};

export type SuspiciousFlag = {
  userId: string;
  fullName: string;
  rule: string;
  severity: string;
  detail: string;
  measured: string;
  threshold: string;
};

export type BirthdayRow = {
  userId: string;
  fullName: string;
  date: string;
};

/** Maaş modelinin Türkçe karşılığı. Bilinmeyen model ham yazılır. */
export const MODEL_LABELS: Record<string, string> = {
  FIXED: 'Sabit Maaş',
  COMMISSION: 'Satış Komisyonu',
  TIP: 'Sabit + Bahşiş',
  HOURLY: 'Saatlik Ücret',
  PROFIT_SHARE: 'Kâr Payı',
};

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Patron',
  MANAGER: 'Müdür',
  CASHIER: 'Kasiyer',
  WAITER: 'Garson',
  KITCHEN: 'Mutfak',
};

/** Kuruş → TL. Tüm parasal gösterim bu tek noktadan geçer. */
export function money(cents: number): string {
  return `₺${(cents / 100).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** `YYYY-MM` dönemini bugünün dönemine göre kaydırır (borç raporu için). */
export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Tarihi Türkçe biçimde yazar. Boşsa "Bilinmiyor". */
export function formatDate(raw: string | null | undefined): string {
  if (!raw) return 'Bilinmiyor';
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return 'Bilinmiyor';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}