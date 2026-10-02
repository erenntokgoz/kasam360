import { useCallback, useEffect, useMemo, useState } from 'react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useFloorStore } from '../../store/useFloorStore';
import { toast as useToast } from '@core/components/ui/toast';
import {
  isSameCalendarDay,
  getOpenedAt,
  getClosedAt,
  getCashierId,
  getCashierName,
  getActualCents,
  getDifferenceCents,
} from './helpers';
import type { DailySummaryDto, OpenShiftDto, ShiftHistoryDto, ShiftRow } from './types';

interface UseEndOfDayDataArgs {
  actorRole: string;
  initialLoading: boolean;
  initialSummary?: DailySummaryDto;
  initialOpenShifts?: OpenShiftDto[];
  initialShiftHistory?: ShiftHistoryDto[];
  onNotify: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

/**
 * Hesap Defteri ekranının veri katmanı.
 * Kasa/vardiya verisi, arşiv, türetilmiş özetler ve arama burada toplanır;
 * sunum katmanı yalnızca bileşen kurar.
 */
export const useEndOfDayData = ({
  actorRole,
  initialLoading,
  initialSummary,
  initialOpenShifts,
  initialShiftHistory,
  onNotify,
}: UseEndOfDayDataArgs) => {
  const { tables, fetchFloorPlan } = useFloorStore();

  const [summary, setSummary] = useState<DailySummaryDto | null>(initialSummary ?? null);
  const [openShifts, setOpenShifts] = useState<OpenShiftDto[]>(initialOpenShifts ?? []);
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryDto[]>(initialShiftHistory ?? []);
  const [loading, setLoading] = useState(initialLoading);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');

  const loadDailyData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const summaryData = await invoke<DailySummaryDto>('get_daily_summary', { actorRole });
        setSummary(summaryData);

        try {
          const shifts = await invoke<OpenShiftDto[]>('get_open_shifts', { actorRole });
          setOpenShifts(Array.isArray(shifts) ? shifts : []);
        } catch (err) {
          console.warn('Açık vardiyalar yüklenemedi:', err);
          setOpenShifts([]);
        }

        try {
          await fetchFloorPlan();
        } catch (err) {
          console.warn('Masa durumu yüklenemedi:', err);
        }

        try {
          const hist = await invoke<ShiftHistoryDto[]>('get_shift_history', { cashierId: 'ALL' });
          setShiftHistory(Array.isArray(hist) ? hist : []);
        } catch (err) {
          console.warn('Vardiya geçmişi yüklenemedi:', err);
        }

        if (isManualRefresh) {
          onNotify('Hesap defteri başarıyla güncellendi.', 'info');
        }
      } catch (e) {
        console.error('Hesap defteri verileri alınırken hata:', e);
        setError(String(e));
        onNotify('Hesap defteri verileri alınamadı.', 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actorRole, onNotify, fetchFloorPlan]
  );

  const loadHistoryData = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const hist = await invoke<ShiftHistoryDto[]>('get_shift_history', { cashierId: 'ALL' });
      setShiftHistory(Array.isArray(hist) ? hist : []);
    } catch (err) {
      console.error('Defter arşivi yüklenemedi:', err);
      onNotify('Defter arşivi yüklenirken hata oluştu.', 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadDailyData();
  }, [loadDailyData]);

  const openTables = useMemo(() => tables.filter((t) => t.status === 'OCCUPIED'), [tables]);

  const totals = useMemo(() => {
    const totalRevenue = summary?.total_revenue_cents ?? 0;
    const totalOrders = summary?.total_orders ?? 0;
    const averageOrderCents = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    let cash = 0;
    let card = 0;
    let other = 0;

    if (summary?.payment_methods) {
      Object.entries(summary.payment_methods).forEach(([method, amount]) => {
        const lower = method.toLowerCase();
        if (lower.includes('nakit') || lower.includes('cash')) {
          cash += amount;
        } else if (
          lower.includes('kart') ||
          lower.includes('card') ||
          lower.includes('pos') ||
          lower.includes('kredi')
        ) {
          card += amount;
        } else {
          other += amount;
        }
      });
    }

    return { totalRevenue, totalOrders, averageOrderCents, cashTotal: cash, cardTotal: card, otherTotal: other };
  }, [summary]);

  const paymentPercentages = useMemo(() => {
    const { totalRevenue, cashTotal, cardTotal, otherTotal } = totals;

    if (totalRevenue <= 0) {
      return { cashPct: 0, cardPct: 0, otherPct: 0, hasData: false };
    }
    const cashPct = Math.round((cashTotal / totalRevenue) * 100);
    if (otherTotal <= 0) {
      return { cashPct, cardPct: Math.max(0, 100 - cashPct), otherPct: 0, hasData: true };
    }
    const cardPct = Math.round((cardTotal / totalRevenue) * 100);
    return { cashPct, cardPct, otherPct: Math.max(0, 100 - (cashPct + cardPct)), hasData: true };
  }, [totals]);

  /**
   * AGENTS.md finansal kuralı: devir tutarı bilinmiyorsa uydurulmaz.
   * `openingBalanceCents` ve `cashSalesCents` null dönebilir; çizelge "Bilinmiyor" yazar.
   */
  const shiftRows = useMemo<ShiftRow[]>(() => {
    const rows: ShiftRow[] = [];
    const addedIds = new Set<string>();

    openShifts.forEach((os) => {
      const sales = typeof os.cashSalesCents === 'number' ? os.cashSalesCents : null;
      rows.push({ shift: os, isOpen: true, cashSalesCents: sales });
      addedIds.add(os.id);
    });

    shiftHistory.forEach((hs) => {
      if (addedIds.has(hs.id)) return;
      const opened = getOpenedAt(hs);
      const closed = getClosedAt(hs);
      const isToday = isSameCalendarDay(opened) || isSameCalendarDay(closed);

      if (isToday || (!openShifts.length && rows.length < 5)) {
        const sales = typeof hs.cashSalesCents === 'number' ? hs.cashSalesCents : null;
        rows.push({ shift: hs, isOpen: false, cashSalesCents: sales });
        addedIds.add(hs.id);
      }
    });

    return rows;
  }, [openShifts, shiftHistory]);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return shiftHistory;
    const q = historySearch.toLowerCase();
    return shiftHistory.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        getCashierName(s).toLowerCase().includes(q) ||
        getCashierId(s).toLowerCase().includes(q) ||
        (getOpenedAt(s) && getOpenedAt(s).toLowerCase().includes(q))
    );
  }, [shiftHistory, historySearch]);

  return {
    summary,
    openShifts,
    shiftHistory,
    loading,
    refreshing,
    historyLoading,
    error,
    historySearch,
    setHistorySearch,
    openTables,
    totals,
    paymentPercentages,
    shiftRows,
    filteredHistory,
    reload: loadDailyData,
    reloadHistory: loadHistoryData,
    getActualCents,
    getDifferenceCents,
  };
};

/** Toast yöneticisini hook dışında üretip bağımlılık zincirini kısa tutmak için dışa açıldı. */
export const notifySafe = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => {
  try {
    useToast.add({ title: msg, type });
  } catch {
    console.log(`[Toast] ${type}: ${msg}`);
  }
};
