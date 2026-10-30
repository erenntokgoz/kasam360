import { create } from 'zustand';
import type { Shift, ShiftSummary, CashMovement, ZReportData } from '../types/shift';
import { invokeIPC } from '../services/tauriClient';
import { sessionArgs } from './cariStore';
import { useAuthStore } from './authStore';

interface ShiftStore {
  activeShift: Shift | null;
  summary: ShiftSummary | null;
  lastZReport: ZReportData | null;
  isLoading: boolean;
  shiftError: string | null;
  loadShiftData: () => Promise<void>;
  openShift: (openingCashCents: number, cashierId: string, cashierName: string) => Promise<boolean>;
  closeShift: (countedCashCents: number, notes?: string) => Promise<ZReportData>;
  recordCashMovement: (type: 'IN' | 'OUT', amountCents: number, reason: string) => Promise<CashMovement>;
}

interface ShiftWire {
  id: string;
  tenantId: string;
  cashierId: string;
  status: string;
  openedAt: string;
  closedAt?: string | null;
  expectedAmountCents: number;
  actualAmountCents?: number | null;
  differenceCents?: number | null;
}

interface SummaryWire {
  shiftId: string;
  totalSales: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedBalance: number;
  cashSales: number;
  cardSales: number;
  mealCardSales: number;
  veresiyeSales: number;
}

function mapShift(wire: ShiftWire, cashierName: string): Shift {
  return {
    id: wire.id,
    tenantId: wire.tenantId,
    cashierId: wire.cashierId,
    cashierName,
    openingCashCents: wire.expectedAmountCents,
    closingCashCents: wire.actualAmountCents ?? undefined,
    cashDifferenceCents: wire.differenceCents ?? undefined,
    openedAt: wire.openedAt,
    closedAt: wire.closedAt ?? undefined,
    isOpen: wire.status === 'OPEN',
  };
}

function mapSummary(wire: SummaryWire, shift: Shift): ShiftSummary {
  return {
    shiftId: wire.shiftId,
    cashierName: shift.cashierName,
    openedAt: shift.openedAt,
    openingCashCents: shift.openingCashCents,
    totalCashSalesCents: wire.cashSales,
    totalCardSalesCents: wire.cardSales,
    totalMealCardSalesCents: wire.mealCardSales,
    totalVeresiyeCents: wire.veresiyeSales,
    totalCashInCents: wire.totalCashIn,
    totalCashOutCents: wire.totalCashOut,
    expectedCashInDrawerCents: wire.expectedBalance,
    totalSalesCents: wire.totalSales,
  };
}

export const useShiftStore = create<ShiftStore>((set, get) => ({
  activeShift: null,
  summary: null,
  lastZReport: null,
  isLoading: false,
  shiftError: null,

  // Okunamayan vardiya "kapalı" sayılmaz: hata gösterilir, tutar sıfır yazılmaz.
  loadShiftData: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const { actorRole, tenantId } = sessionArgs();
    try {
      set({ isLoading: true, shiftError: null });
      const wire = await invokeIPC<ShiftWire | null>('get_active_shift', {
        cashierId: user.userId,
        tenantId,
        actorRole,
      });
      const shift = wire ? mapShift(wire, user.name) : null;
      set({ activeShift: shift, summary: null });
      if (shift?.isOpen) {
        const summary = await invokeIPC<SummaryWire>('get_shift_summary', {
          shiftId: shift.id,
          tenantId,
          actorRole,
        });
        set({ summary: mapSummary(summary, shift) });
      }
    } catch (error) {
      set({ activeShift: null, summary: null, shiftError: String(error) });
    } finally {
      set({ isLoading: false });
    }
  },

  openShift: async (openingCashCents, cashierId, cashierName) => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const wire = await invokeIPC<ShiftWire>('open_shift', {
        cashierId,
        expectedAmountCents: openingCashCents,
        tenantId,
        actorRole,
      });
      set({ activeShift: mapShift(wire, cashierName), shiftError: null });
      await get().loadShiftData();
      return true;
    } catch (error) {
      set({ shiftError: String(error) });
      return false;
    }
  },

  closeShift: async (countedCashCents) => {
    const user = useAuthStore.getState().user;
    const shift = get().activeShift;
    const summary = get().summary;
    if (!user || !shift) throw new Error('Açık vardiya yok.');
    const { actorRole, tenantId } = sessionArgs();
    const wire = await invokeIPC<ShiftWire>('close_shift', {
      cashierId: user.userId,
      actualAmountCents: countedCashCents,
      tenantId,
      actorRole,
    });
    const report: ZReportData = {
      reportNumber: `Z-${wire.id.slice(-6).toUpperCase()}`,
      tenantName: '',
      taxNumber: '',
      dateStr: new Date().toLocaleDateString('tr-TR'),
      shiftId: wire.id,
      cashierName: user.name,
      openingCashCents: shift.openingCashCents,
      countedCashCents,
      expectedCashCents: countedCashCents - (wire.differenceCents ?? 0),
      differenceCents: wire.differenceCents ?? 0,
      cashSalesCents: summary?.totalCashSalesCents ?? 0,
      cardSalesCents: summary?.totalCardSalesCents ?? 0,
      mealCardSalesCents: summary?.totalMealCardSalesCents ?? 0,
      veresiyeSalesCents: summary?.totalVeresiyeCents ?? 0,
      totalRevenueCents: summary?.totalSalesCents ?? 0,
      totalVatCents: 0,
      voidTotalCents: 0,
      discountTotalCents: 0,
      orderCount: 0,
      closedAt: wire.closedAt ?? new Date().toISOString(),
    };
    set({ lastZReport: report, activeShift: null, summary: null });
    return report;
  },

  recordCashMovement: async (type, amountCents, reason) => {
    const shiftId = get().activeShift?.id;
    if (!shiftId) throw new Error('Açık vardiya yok.');
    const { actorId, actorRole, tenantId } = sessionArgs();
    const command = type === 'IN' ? 'cash_in' : 'cash_out';
    const movement = await invokeIPC<CashMovement>(command, {
      shiftId,
      amountCents,
      reason,
      actorId,
      actorRole,
      tenantId,
    });
    await get().loadShiftData();
    return movement;
  },
}));
