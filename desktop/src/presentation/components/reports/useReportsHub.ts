import { useCallback, useEffect, useMemo, useState } from 'react';

import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  AdjustmentsReport,
  ReceiptReportRow,
  ReportRange,
  SalesReport,
  ShiftReportRow,
  buildPresetRange,
  rangeDayCount,
} from './reportTypes';

/**
 * Rapor merkezinin tek veri katmanı.
 *
 * Neden tek kanca: `OwnerSalesTab` ve `ReportsPanel` aynı üç veri noktasını
 * ayrı ayrı, farklı filtrelerle çekiyordu. Artık dört komut da tek aralık ve
 * tek tenant altında (tauriInvoke oturumdan enjekte eder) paralel okunur.
 *
 * Hata politikası: bir bölüm çökerse tüm merkez boşalmaz; bölüm null kalır ve
 * `sectionErrors` içinde mesajı gösterilir. Böylece "rapor yok" ile
 * "rapor okunamadı" ayrımı kaybolmaz.
 */
export interface ReportsHubState {
  sales: SalesReport | null;
  shifts: ShiftReportRow[];
  receipts: ReceiptReportRow[];
  adjustments: AdjustmentsReport | null;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage: string | null;
  sectionErrors: string[];
  dayCount: number;
  refresh: (withSpinner?: boolean) => void;
}

const REPORTS_LIMIT = 200;

export function useReportsHub(range: ReportRange): ReportsHubState {
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [shifts, setShifts] = useState<ShiftReportRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptReportRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentsReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const dayCount = useMemo(() => rangeDayCount(range), [range]);

  useEffect(() => {
    let cancelled = false;
    const failures: string[] = [];

    async function load(): Promise<void> {
      setIsLoading(true);
      setIsRefreshing(false);
      setErrorMessage(null);
      setSectionErrors([]);
      failures.length = 0;

      const settle = <T,>(promise: Promise<T>, fallback: T, label: string): Promise<T> => {
        return promise
          .then((value) => value)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            failures.push(`${label}: ${message}`);
            return fallback;
          });
      };

      const [salesResult, shiftResult, receiptResult, adjustmentResult] = await Promise.all([
        settle<SalesReport | null>(
          tauriInvoke<SalesReport>('get_sales_report', { from: range.from, to: range.to }),
          null,
          'Satış raporu',
        ),
        settle<ShiftReportRow[]>(
          tauriInvoke<ShiftReportRow[]>('get_shift_report', {
            from: range.from,
            to: range.to,
            limit: REPORTS_LIMIT,
          }),
          [],
          'Vardiya raporu',
        ),
        settle<ReceiptReportRow[]>(
          tauriInvoke<ReceiptReportRow[]>('get_receipts_report', {
            from: range.from,
            to: range.to,
            limit: REPORTS_LIMIT,
          }),
          [],
          'Fiş raporu',
        ),
        settle<AdjustmentsReport | null>(
          tauriInvoke<AdjustmentsReport>('get_adjustments_report', {
            from: range.from,
            to: range.to,
          }),
          null,
          'İptal / iade / zayi raporu',
        ),
      ]);

      if (cancelled) return;
      setSales(salesResult);
      setShifts(shiftResult);
      setReceipts(receiptResult);
      setAdjustments(adjustmentResult);
      setSectionErrors([...failures]);
      if (failures.length > 0 && salesResult === null && shiftResult.length === 0) {
        setErrorMessage('Rapor verileri okunamadı.');
      }
      setIsLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, reloadToken]);

  const refresh = useCallback((withSpinner = false) => {
    if (withSpinner) setIsRefreshing(true);
    setReloadToken((token) => token + 1);
  }, []);

  return {
    sales,
    shifts,
    receipts,
    adjustments,
    isLoading,
    isRefreshing,
    errorMessage,
    sectionErrors,
    dayCount,
    refresh,
  };
}

/** Hazır aralık seçimi için başlangıç durumu: bugün. */
export function useInitialReportRange(): ReportRange {
  return useMemo(() => buildPresetRange('today'), []);
}
