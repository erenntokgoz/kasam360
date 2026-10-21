import { create } from 'zustand';
import type { Shift, ShiftSummary, CashMovement, ZReportData } from '../types/shift';
import { invokeIPC } from '../services/tauriClient';

interface ShiftStore {
  activeShift: Shift | null;
  summary: ShiftSummary | null;
  lastZReport: ZReportData | null;
  isLoading: boolean;
  loadShiftData: () => Promise<void>;
  openShift: (openingCashCents: number, cashierId: string, cashierName: string) => Promise<boolean>;
  closeShift: (countedCashCents: number, notes?: string) => Promise<ZReportData>;
  recordCashMovement: (type: 'IN' | 'OUT', amountCents: number, reason: string) => Promise<CashMovement>;
}

export const useShiftStore = create<ShiftStore>((set, get) => ({
  activeShift: null,
  summary: null,
  lastZReport: null,
  isLoading: false,

  loadShiftData: async () => {
    try {
      set({ isLoading: true });
      const shift = await invokeIPC<Shift | null>('get_active_shift');
      set({ activeShift: shift });

      if (shift && shift.isOpen) {
        const summary = await invokeIPC<ShiftSummary>('get_shift_summary', { shiftId: shift.id });
        set({ summary });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  openShift: async (openingCashCents, cashierId, cashierName) => {
    try {
      const shift = await invokeIPC<Shift>('open_shift', {
        openingCashCents,
        cashierId,
        cashierName,
      });
      set({ activeShift: shift });
      await get().loadShiftData();
      return true;
    } catch {
      return false;
    }
  },

  closeShift: async (countedCashCents, notes) => {
    const report = await invokeIPC<ZReportData>('close_shift', {
      countedCashCents,
      notes,
    });
    set({
      lastZReport: report,
      activeShift: null,
      summary: null,
    });
    return report;
  },

  recordCashMovement: async (type, amountCents, reason) => {
    const shiftId = get().activeShift?.id || 'shf_active';
    const cmd = type === 'IN' ? 'cash_in' : 'cash_out';
    const movement = await invokeIPC<CashMovement>(cmd, {
      shiftId,
      amountCents,
      reason,
    });
    await get().loadShiftData();
    return movement;
  },
}));
