import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  CreditCard,
  Banknote,
  RefreshCw,
  Printer,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  Calendar,
  User,
  Receipt,
  Search,
  Check,
  Layers,
  BookOpen,
  ShieldCheck,
  Users,
  ArrowRightLeft,
  BarChart3,
} from 'lucide-react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { usePermission } from '../../hooks/usePermission';
import { useFloorStore } from '../../store/useFloorStore';
import { toast as useToast } from '@core/components/ui/toast';
import { QuickTransactionModal, QuickTransactionType } from './ui/QuickTransactionModal';
import { DirectoriesTab } from './ui/DirectoriesTab';
import { DebtsBalanceTab } from './ui/DebtsBalanceTab';
import { ExpensesTab } from './ui/ExpensesTab';
import { FinancialReportsTab } from './ui/FinancialReportsTab';
import { LedgerReceiptMovements } from '../ledger/LedgerReceiptMovements';

// Günlük ciro ve ödeme yöntemleri dağılımı veri modeli (kuruş cinsinden)
export interface DailySummaryDto {
  total_revenue_cents: number;
  total_orders: number;
  payment_methods: Record<string, number>;
}

// Açık vardiya ve kasa durumu veri modeli
export interface OpenShiftDto {
  id: string;
  cashierId?: string;
  cashier_id?: string;
  cashierName?: string;
  cashier_name?: string;
  openedAt?: string;
  opened_at?: string;
  openingBalance?: number;
  expected_amount_cents?: number;
  cashSalesCents?: number;
  cashInCents?: number;
  cashOutCents?: number;
}

// Geçmiş kapatılmış vardiya ve Z-raporu kayıt modeli
export interface ShiftHistoryDto {
  id: string;
  tenantId?: string;
  tenant_id?: string;
  cashierId?: string;
  cashier_id?: string;
  cashierName?: string;
  cashier_name?: string;
  status: string;
  openedAt?: string;
  opened_at?: string;
  closedAt?: string | null;
  closed_at?: string | null;
  expectedAmountCents?: number;
  expected_amount_cents?: number;
  actualAmountCents?: number | null;
  actual_amount_cents?: number | null;
  differenceCents?: number | null;
  difference_cents?: number | null;
  cashSalesCents?: number;
  cashInCents?: number;
  cashOutCents?: number;
}

// Gün sonu defter kapatma işlem yanıtı
export interface CloseDayResultDto {
  success: boolean;
  message: string;
  closedShiftsCount?: number;
  closed_shifts_count?: number;
  totalRevenueCents?: number;
  total_revenue_cents?: number;
  totalOrders?: number;
  total_orders?: number;
  closedAt?: string;
  closed_at?: string;
}

// Hesap Defteri ana sekme görünümleri
export type TabType = 'GUNUN_DEFTERI' | 'GECMIS_ARSIV' | 'CARI_REHBERLER' | 'BORC_ALACAK' | 'GIDER_DEFTERI' | 'FINANSAL_RAPORLAR';

// Bileşen parametreleri (SSR desteği ve test izolasyonu)
export interface EndOfDayContainerProps {
  initialLoading?: boolean;
  initialSummary?: DailySummaryDto;
  initialOpenShifts?: OpenShiftDto[];
  initialShiftHistory?: ShiftHistoryDto[];
}

/**
 * Hesap Defteri (Gün Sonu) & Kasa Vardiya Çizelgesi Ekranı.
 * AGENTS.md gereksinimlerine uygun olarak #060609 zemin üzerinde bağımsız,
 * yumuşak kenarlı (rounded-3xl) renksiz şeffaf cam (Frosted Glass) adalar mimarisiyle çalışır.
 */
export const EndOfDayContainer: React.FC<EndOfDayContainerProps> = ({
  initialLoading = false,
  initialSummary,
  initialOpenShifts,
  initialShiftHistory,
} = {}) => {
  const user = useAuthStore((state) => state.user);
  const actorRole = user?.role ?? 'Cashier';
  const actorName = user?.name ?? 'Yetkili';
  const tenantId = user?.tenantId ?? 'DEFAULT_TENANT';
  // P&L sekmesi ayrı bir yetki satırına bağlıdır; defterin kendisi kısmi erişime açık
  const canSeeFinancialReports = usePermission().can('reportsAccess');

  // Açık masa denetimi için salon durumunu al
  const { tables, fetchFloorPlan } = useFloorStore();

  // Defter veri durumları
  const [summary, setSummary] = useState<DailySummaryDto | null>(initialSummary ?? null);
  const [openShifts, setOpenShifts] = useState<OpenShiftDto[]>(initialOpenShifts ?? []);
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryDto[]>(initialShiftHistory ?? []);

  // UI durumları: 2 net defter sekmesi
  const [activeTab, setActiveTab] = useState<TabType>('GUNUN_DEFTERI');
  const [loading, setLoading] = useState(initialLoading);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal ve mühürleme işlem durumları
  const [showConfirmCloseModal, setShowConfirmCloseModal] = useState(false);
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [selectedZReportShift, setSelectedZReportShift] = useState<ShiftHistoryDto | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [lastClosedResult, setLastClosedResult] = useState<CloseDayResultDto | null>(null);
  const [quickModalType, setQuickModalType] = useState<QuickTransactionType | null>(null);

  // Bildirim yöneticisi
  const addToast = useCallback((msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    try {
      useToast.add({ title: msg, type });
    } catch {
      console.log(`[Toast] ${type}: ${msg}`);
    }
  }, []);

  // AGENTS.md Finansal Kuralı: Tutar hesaplamaları tam sayı kuruş (cents) formatındadır
  const formatCurrency = (cents: number | undefined | null) => {
    const safeCents = typeof cents === 'number' && !isNaN(cents) ? cents : 0;
    return (safeCents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    });
  };

  // Tarih ve saat formatlayıcı
  const formatDateTime = (dateStr: string | undefined | null) => {
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
  const isSameCalendarDay = (dateStr: string | undefined | null) => {
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
  const getOpenedAt = (s: ShiftHistoryDto | OpenShiftDto) => s.opened_at || s.openedAt || '';
  const getClosedAt = (s: ShiftHistoryDto) => s.closed_at || s.closedAt || null;
  const getCashierId = (s: ShiftHistoryDto | OpenShiftDto) => s.cashier_id || s.cashierId || 'Kasiyer';
  const getCashierName = (s: ShiftHistoryDto | OpenShiftDto) => s.cashierName || s.cashier_name || getCashierId(s);
  const getExpectedCents = (s: ShiftHistoryDto | OpenShiftDto) =>
    'expected_amount_cents' in s && typeof s.expected_amount_cents === 'number'
      ? s.expected_amount_cents
      : 'expectedAmountCents' in s && typeof s.expectedAmountCents === 'number'
      ? s.expectedAmountCents
      : 'openingBalance' in s && typeof s.openingBalance === 'number'
      ? s.openingBalance
      : 0;
  const getActualCents = (s: ShiftHistoryDto) => s.actual_amount_cents ?? s.actualAmountCents ?? null;
  const getDifferenceCents = (s: ShiftHistoryDto) => s.difference_cents ?? s.differenceCents ?? null;

  // Açık masaların tespiti (Defteri mühürlemeden önce açık hesap uyarısı vermek için)
  const openTables = useMemo(() => {
    return tables.filter((t) => t.status === 'OCCUPIED');
  }, [tables]);

  // Günlük defter verilerini ve açık masaları yükleme
  const loadDailyData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Günlük hasılat ve ödeme dökümünü çek
      const summaryData = await invoke<DailySummaryDto>('get_daily_summary', { actorRole });
      setSummary(summaryData);

      // 2. Açık vardiyaları çek
      try {
        const shifts = await invoke<OpenShiftDto[]>('get_open_shifts', { actorRole });
        setOpenShifts(Array.isArray(shifts) ? shifts : []);
      } catch (err) {
        console.warn('Açık vardiyalar yüklenemedi:', err);
        setOpenShifts([]);
      }

      // 3. Açık masa kontrolü için salon planını tazele
      try {
        await fetchFloorPlan();
      } catch (err) {
        console.warn('Masa durumu yüklenemedi:', err);
      }

      // 4. Vardiya çizelgesini doldurmak için geçmişi çek
      try {
        const hist = await invoke<ShiftHistoryDto[]>('get_shift_history', { cashierId: 'ALL' });
        setShiftHistory(Array.isArray(hist) ? hist : []);
      } catch (err) {
        console.warn('Vardiya geçmişi yüklenemedi:', err);
      }

      if (isManualRefresh) {
        addToast('Hesap defteri başarıyla güncellendi.', 'info');
      }
    } catch (e) {
      console.error('Hesap defteri verileri alınırken hata:', e);
      setError(String(e));
      addToast('Hesap defteri verileri alınamadı.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [actorRole, addToast, fetchFloorPlan]);

  // Geçmiş Z-Raporları ve arşiv kayıtlarını yükleme
  const loadHistoryData = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const hist = await invoke<ShiftHistoryDto[]>('get_shift_history', { cashierId: 'ALL' });
      setShiftHistory(Array.isArray(hist) ? hist : []);
    } catch (err) {
      console.error('Defter arşivi yüklenemedi:', err);
      addToast('Defter arşivi yüklenirken hata oluştu.', 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [addToast]);

  // İlk yükleme
  useEffect(() => {
    loadDailyData();
  }, [loadDailyData]);

  // Arşiv sekmesine geçildiğinde verileri güncelle
  useEffect(() => {
    if (activeTab === 'GECMIS_ARSIV') {
      loadHistoryData();
    }
  }, [activeTab, loadHistoryData]);

  // Günün Defter Kapanışı & Mühürleme İşlemi (close_day)
  const handleCloseDay = async () => {
    setIsClosingDay(true);
    try {
      const result = await invoke<CloseDayResultDto>('close_day', {
        actorRole,
        actorId: user?.userId,
      });

      setLastClosedResult(result);
      setShowConfirmCloseModal(false);
      addToast(result?.message || 'Hesap defteri başarıyla kapatıldı ve mühürlendi.', 'success');

      // Verileri ve arşivi tazele
      await loadDailyData(true);
      await loadHistoryData();

      // Mühürleme sonrası Z-Raporu önizlemesini aç
      setSelectedZReportShift(null);
      setShowZReportModal(true);
    } catch (e) {
      console.error('Hesap defteri mühürlenemedi:', e);
      addToast(`Hesap defteri mühürlenemedi: ${String(e)}`, 'error');
    } finally {
      setIsClosingDay(false);
    }
  };

  // ESC/POS termal basım. Faz 7: içerik istemciden gönderilmez; vardiya veya gün
  // belgesi veritabanındaki kayıtlardan basılır.
  const handlePrintZReport = async (shiftOverride?: ShiftHistoryDto | null) => {
    setIsPrinting(true);

    try {
      if (shiftOverride) {
        await invoke('print_z_report', {
          shiftId: shiftOverride.id,
          actorRole,
          tenantId,
        });
      } else {
        await invoke('print_day_z_report', { actorRole, tenantId });
      }
      addToast('Mali Z-Raporu başarıyla termal yazıcıya gönderildi.', 'success');
    } catch (e) {
      console.error('Yazıcı hatası:', e);
      addToast('Yazıcıya gönderme başarısız oldu.', 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  // Finansal Skor Kartları Hesaplamaları
  const totalRevenue = summary?.total_revenue_cents || 0;
  const totalOrders = summary?.total_orders || 0;
  const averageOrderCents = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Nakit Kasası ve Kredi Kartı / POS Tutarlarını Ayrıştırma
  const { cashTotal, cardTotal, otherTotal } = useMemo(() => {
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

    return { cashTotal: cash, cardTotal: card, otherTotal: other };
  }, [summary]);

  // Ödeme dağılımı yüzdeleri (Orantılı görsel dağılım barı için)
  const paymentPercentages = useMemo(() => {
    if (totalRevenue <= 0) {
      return { cashPct: 0, cardPct: 0, otherPct: 0, hasData: false };
    }
    if (otherTotal <= 0) {
      const cashPct = Math.round((cashTotal / totalRevenue) * 100);
      const cardPct = Math.max(0, 100 - cashPct);
      return { cashPct, cardPct, otherPct: 0, hasData: true };
    }
    const cashPct = Math.round((cashTotal / totalRevenue) * 100);
    const cardPct = Math.round((cardTotal / totalRevenue) * 100);
    const otherPct = Math.max(0, 100 - (cashPct + cardPct));
    return { cashPct, cardPct, otherPct, hasData: true };
  }, [totalRevenue, cashTotal, cardTotal, otherTotal]);

  // Günün vardiyalarının çizelge modeli: Açık kasalar + Bugün kapatılan vardiyalar
  const todayShifts = useMemo(() => {
    const list: Array<{
      id: string;
      cashierName: string;
      status: string;
      openedAt: string;
      closedAt: string | null;
      openingBalanceCents: number;
      cashSalesCents: number;
      cashMovementNetCents: number;
      expectedAmountCents: number;
      actualAmountCents: number | null;
      differenceCents: number | null;
    }> = [];

    const addedIds = new Set<string>();

    // 1. Açık vardiyaları ekle
    openShifts.forEach((os) => {
      const exp = getExpectedCents(os);
      const opening = os.openingBalance ?? exp;
      const cashIn = os.cashInCents ?? 0;
      const cashOut = os.cashOutCents ?? 0;
      const sales = os.cashSalesCents ?? Math.max(0, exp - opening);

      list.push({
        id: os.id,
        cashierName: getCashierName(os),
        status: 'OPEN',
        openedAt: getOpenedAt(os),
        closedAt: null,
        openingBalanceCents: opening,
        cashSalesCents: sales,
        cashMovementNetCents: cashIn - cashOut,
        expectedAmountCents: exp,
        actualAmountCents: null,
        differenceCents: null,
      });
      addedIds.add(os.id);
    });

    // 2. Bugün tamamlanmış veya geçmiş vardiyaları ekle
    shiftHistory.forEach((hs) => {
      if (addedIds.has(hs.id)) return;
      const opened = getOpenedAt(hs);
      const closed = getClosedAt(hs);
      const isToday = isSameCalendarDay(opened) || isSameCalendarDay(closed);

      if (isToday || (!openShifts.length && list.length < 5)) {
        const exp = getExpectedCents(hs);
        const opening = (hs as unknown as Record<string, unknown>).openingBalance as number | undefined ?? Math.max(0, Math.round(exp * 0.35));
        const cashIn = hs.cashInCents ?? 0;
        const cashOut = hs.cashOutCents ?? 0;
        const sales = hs.cashSalesCents ?? Math.max(0, exp - opening);

        list.push({
          id: hs.id,
          cashierName: getCashierName(hs),
          status: hs.status || 'CLOSED',
          openedAt: opened,
          closedAt: closed,
          openingBalanceCents: opening,
          cashSalesCents: sales,
          cashMovementNetCents: cashIn - cashOut,
          expectedAmountCents: exp,
          actualAmountCents: getActualCents(hs),
          differenceCents: getDifferenceCents(hs),
        });
        addedIds.add(hs.id);
      }
    });

    return list;
  }, [openShifts, shiftHistory]);

  // Arşiv listesi filtreleme
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

  // Mutabakat rozeti oluşturucu (Denk / Açık / Fazla)
  const renderMutabakatBadge = (status: string, diff: number | null) => {
    const isOpen = status?.toUpperCase() === 'OPEN';

    if (isOpen) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/25">
          <RefreshCw size={12} className="animate-spin text-amber-500" />
          <span>Vardiya Aktif</span>
        </span>
      );
    }

    if (diff === null || diff === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 size={13} />
          <span>Denk (Kasa Denk)</span>
        </span>
      );
    }

    if (diff < 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          <AlertTriangle size={13} />
          <span>Açık ({formatCurrency(diff)} Fark Var)</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
        <AlertTriangle size={13} />
        <span>Fazla (+{formatCurrency(diff)} Fark Var)</span>
      </span>
    );
  };

  // Yükleme durumu gösterimi
  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#007AFF]/30 border-t-[#007AFF] shadow-xl" />
          <p className="dark:text-zinc-400 text-zinc-600 font-medium tracking-wide">Hesap Defteri yükleniyor...</p>
        </div>
      </div>
    );
  }

  // Hata durumu gösterimi
  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900 p-6">
        <div className="max-w-md w-full backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 text-center shadow-xl">
          <AlertCircle size={44} className="text-[#FF3B30] mx-auto mb-3" />
          <h2 className="text-lg font-semibold dark:text-white text-zinc-900 mb-2">Defter Verileri Alınamadı</h2>
          <p className="dark:text-zinc-400 text-zinc-600 text-sm mb-6">{error}</p>
          <button
            type="button"
            onClick={() => loadDailyData()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-sm font-semibold bg-[#007AFF] hover:bg-[#0071E3] text-white shadow-lg shadow-[#007AFF]/20 active:scale-[0.98] transition-all cursor-pointer"
          >
            <RefreshCw size={16} />
            <span>Tekrar Dene</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col dark:bg-[#060609] bg-[#f5f5f7] dark:text-white text-zinc-900 p-4 md:p-8 overflow-y-auto selection:bg-[#007AFF]/20">
      {/* macOS Frosted Glass Bağımsız Yüzen Üst Başlık Adası */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 p-6 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-xl">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 flex items-center gap-3">
            <BookOpen size={28} className="text-[#007AFF] stroke-[1.8]" />
            <span>Hesap Defteri</span>
          </h1>
          <p className="text-xs md:text-sm dark:text-zinc-400 text-zinc-600 mt-1">
            Günlük Kasa Mutabakatı &bull; Şube:{' '}
            <span className="dark:text-zinc-200 text-zinc-800 font-medium">{tenantId}</span> &bull; Yetkili:{' '}
            <span className="dark:text-zinc-200 text-zinc-800 font-medium">{actorName}</span> ({actorRole}) &bull;{' '}
            <span className="dark:text-zinc-400 text-zinc-500 font-mono">
              {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </p>
        </div>

        {/* 4 Hızlı Aksiyon Cam Butonları & İşlem Menüsü */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickModalType('GELIR')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
            <span>+ Gelir</span>
          </button>
          <button
            type="button"
            onClick={() => setQuickModalType('GIDER')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" />
            <span>- Gider</span>
          </button>
          <button
            type="button"
            onClick={() => setQuickModalType('BORC')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]" />
            <span>Borç</span>
          </button>
          <button
            type="button"
            onClick={() => setQuickModalType('ALACAK')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-400 border border-sky-500/30 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.7)]" />
            <span>Alacak</span>
          </button>

          <div className="h-6 w-px dark:bg-white/10 bg-black/10 mx-1 hidden sm:block" />

          <button
            type="button"
            onClick={() => loadDailyData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
            title="Defteri Yenile"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-zinc-400' : 'dark:text-zinc-300 text-zinc-600'} />
            <span>Defteri Yenile</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedZReportShift(null);
              setShowZReportModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <FileText size={15} />
            <span>Mali Z-Raporu İncele</span>
          </button>
        </div>
      </div>

      {/* 5+1 Net Görünüm Sekmesi (Apple macOS Segmented Control) — Bağımsız Yüzen Cam Kapsül */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-3xl mb-6 w-fit shrink-0 backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 dark:border-white/10 border-black/[0.08] border shadow-xl">
        <button
          type="button"
          onClick={() => setActiveTab('GUNUN_DEFTERI')}
          title="Bugünkü Gün Sonu"
          aria-label="Bugünkü Gün Sonu"
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'GUNUN_DEFTERI'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <Layers size={14} />
          <span>Günün Defteri (Kasa & Vardiyalar)</span>
          <span className="sr-only">Bugünkü Gün Sonu</span>
          {openShifts.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 font-mono">
              {openShifts.length} Kasa Açık
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CARI_REHBERLER')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'CARI_REHBERLER'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <Users size={14} />
          <span>Cari Rehberler (5 Rehber)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('BORC_ALACAK')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'BORC_ALACAK'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <ArrowRightLeft size={14} />
          <span>Borç & Alacak Bilanço</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('GIDER_DEFTERI')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'GIDER_DEFTERI'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <FileText size={14} />
          <span>Gider Defteri</span>
        </button>

        {/* P&L sekmesi "Raporlar" yetkisine bağlıdır: kasiyer Hesap Defteri'ne
            kısmen erişir ancak gelir/gider bilançosunu göremez (SPEC §34). */}
        {canSeeFinancialReports && (
        <button
          type="button"
          onClick={() => setActiveTab('FINANSAL_RAPORLAR')}
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'FINANSAL_RAPORLAR'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <BarChart3 size={14} />
          <span>Finansal Raporlar (P&L)</span>
        </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('GECMIS_ARSIV')}
          title="Geçmiş Z-Raporları Arşivi"
          aria-label="Geçmiş Z-Raporları Arşivi"
          className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'GECMIS_ARSIV'
              ? 'dark:bg-white/15 bg-white text-zinc-900 dark:text-white shadow-sm backdrop-blur-md'
              : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.03]'
          }`}
        >
          <Calendar size={14} />
          <span>Geçmiş Defter Kayıtları (Arşiv)</span>
          <span className="sr-only">Geçmiş Z-Raporları Arşivi</span>
          {shiftHistory.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full dark:bg-white/10 bg-black/[0.05] dark:text-zinc-300 text-zinc-700 font-mono">
              {shiftHistory.length}
            </span>
          )}
        </button>
      </div>

      {/* SEKME 1: GÜNÜN DEFTERİ (KASA & VARDİYALAR) */}
      {activeTab === 'GUNUN_DEFTERI' && (
        <div className="space-y-6">
          {/* 4 Net Skor Kartı (Defter Özeti) — Bağımsız Yüzen Cam Adalar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Kart 1: Günlük Ciro */}
            <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                  Günlük Ciro
                </p>
                <p className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono">
                  {formatCurrency(totalRevenue)}
                </p>
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Günlük Net Ciro (Hasılat)</p>
              </div>
              <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-emerald-600 dark:text-emerald-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
                <TrendingUp size={24} />
              </div>
            </div>

            {/* Kart 2: Fiziki Nakit Kasa */}
            <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                  Fiziki Nakit Kasa
                </p>
                <p className="text-2xl md:text-3xl font-semibold tracking-tight text-amber-600 dark:text-amber-300 font-mono">
                  {formatCurrency(cashTotal)}
                </p>
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Fiziki nakit çekmecesi</p>
              </div>
              <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-amber-600 dark:text-amber-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
                <Banknote size={24} />
              </div>
            </div>

            {/* Kart 3: Kredi Kartı / POS */}
            <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                  Kredi Kartı / POS
                </p>
                <p className="text-2xl md:text-3xl font-semibold tracking-tight text-[#007AFF] dark:text-blue-300 font-mono">
                  {formatCurrency(cardTotal)}
                </p>
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Banka ve slip tahsilatı</p>
              </div>
              <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
                <CreditCard size={24} />
              </div>
            </div>

            {/* Kart 4: Adisyon Sayısı */}
            <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
                  Adisyon Sayısı
                </p>
                <p className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono">
                  {totalOrders} <span className="text-sm font-normal dark:text-zinc-400 text-zinc-500">Adet</span>
                </p>
                <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">
                  Toplam Adisyon Sayısı &bull; Ort. {formatCurrency(averageOrderCents)}
                </p>
              </div>
              <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-purple-600 dark:text-purple-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
                <Receipt size={24} />
              </div>
            </div>
          </div>

          {/* Finansal Hareketler & Fiş Görüntüleyici — Faz 7: fiş ayrı ekran değil,
              tahsilat satırından açılan bir penceredir. */}
          <div className="mb-6">
            <LedgerReceiptMovements
              onNotify={(message, tone) => addToast(message, tone === 'success' ? 'success' : 'error')}
            />
          </div>

          {/* Ana Gövde: 2 Kolonlu Dengeli Yerleşim (Sol: Dağılım & Vardiya Çizelgesi, Sağ: Güvenli Defter Kapanışı & Mühürleme) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* SOL ALAN: Ödeme Dağılımı + Kasa & Vardiya Çizelgesi */}
            <div className="lg:col-span-2 space-y-6">
              {/* Ödeme Dağılımı — Bağımsız Yüzen Cam Ada */}
              <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                      <CreditCard size={18} />
                    </div>
                    <h2 className="text-base font-semibold dark:text-white text-zinc-900">
                      Ödeme Dağılımı (Nakit vs Kart)
                    </h2>
                  </div>
                  <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">
                    Toplam: {formatCurrency(totalRevenue)}
                  </span>
                </div>

                {/* Orantılı Dağılım Barı */}
                <div className="w-full dark:bg-white/[0.06] bg-black/[0.05] rounded-full h-3.5 p-0.5 flex overflow-hidden border dark:border-white/10 border-black/[0.08] mb-4">
                  {paymentPercentages.hasData ? (
                    <>
                      {paymentPercentages.cashPct > 0 && (
                        <div
                          className="bg-emerald-500 h-full rounded-l-full transition-all duration-500"
                          style={{ width: `${paymentPercentages.cashPct}%` }}
                          title={`Nakit: %${paymentPercentages.cashPct}`}
                        />
                      )}
                      {paymentPercentages.cardPct > 0 && (
                        <div
                          className={`bg-[#007AFF] h-full transition-all duration-500 ${
                            paymentPercentages.cashPct === 0 ? 'rounded-l-full' : ''
                          } ${paymentPercentages.otherPct === 0 ? 'rounded-r-full' : ''}`}
                          style={{ width: `${paymentPercentages.cardPct}%` }}
                          title={`Kredi Kartı / POS: %${paymentPercentages.cardPct}`}
                        />
                      )}
                      {paymentPercentages.otherPct > 0 && (
                        <div
                          className="bg-purple-500 h-full rounded-r-full transition-all duration-500"
                          style={{ width: `${paymentPercentages.otherPct}%` }}
                          title={`Diğer: %${paymentPercentages.otherPct}`}
                        />
                      )}
                    </>
                  ) : (
                    <div className="w-full dark:bg-white/[0.02] bg-black/[0.02] h-full rounded-full flex items-center justify-center text-[10px] dark:text-zinc-500 text-zinc-400">
                      Henüz gün içi satış verisi oluşmadı
                    </div>
                  )}
                </div>

                {/* Dağılım Detay Kartları */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Fiziki Nakit</p>
                        <p className="text-xs dark:text-zinc-500 text-zinc-500">%{paymentPercentages.cashPct}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
                      {formatCurrency(cashTotal)}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shrink-0" />
                      <div>
                        <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Kredi Kartı / POS</p>
                        <p className="text-xs dark:text-zinc-500 text-zinc-500">%{paymentPercentages.cardPct}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
                      {formatCurrency(cardTotal)}
                    </span>
                  </div>

                  {otherTotal > 0 && (
                    <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                        <div>
                          <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Diğer / Yemek Kartı</p>
                          <p className="text-xs dark:text-zinc-500 text-zinc-500">%{paymentPercentages.otherPct}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
                        {formatCurrency(otherTotal)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* KASA & VARDİYA ÇİZELGESİ (MANTIKLI DEFTER TABLOSU) — Bağımsız Yüzen Cam Ada */}
              <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-amber-600 dark:text-amber-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                      <Layers size={18} />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold dark:text-white text-zinc-900">
                        Kasa & Vardiya Çizelgesi
                      </h2>
                      <p className="text-xs dark:text-zinc-400 text-zinc-500">
                        Kasiyer Kasa Takibi &bull; Açılış devri, nakit tahsilatlar, hareketler, sayım ve mutabakat
                      </p>
                    </div>
                  </div>
                  <span className="text-xs">
                    {openShifts.length > 0 ? (
                      <span className="text-amber-600 dark:text-amber-300 font-medium px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/25">
                        {openShifts.length} Aktif Açık Kasa
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-300 font-medium px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25">
                        Tüm Kasalar Kapalı
                      </span>
                    )}
                  </span>
                </div>

                {todayShifts.length > 0 ? (
                  <div className="overflow-x-auto rounded-2xl border dark:border-white/10 border-black/[0.06]">
                    <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
                      <thead className="dark:bg-white/[0.03] bg-black/[0.02] text-[11px] font-semibold uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
                        <tr>
                          <th className="px-4 py-3.5">Kasiyer / Vardiya</th>
                          <th className="px-4 py-3.5">Açılış Bakiyesi</th>
                          <th className="px-4 py-3.5">Nakit Tahsilat</th>
                          <th className="px-4 py-3.5">Nakit Giriş/Çıkış</th>
                          <th className="px-4 py-3.5">Beklenen Kasa</th>
                          <th className="px-4 py-3.5">Fiili Sayım</th>
                          <th className="px-4 py-3.5 text-right">Kasa Farkı Uyarısı</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                        {todayShifts.map((shift) => {
                          const isOpen = shift.status?.toUpperCase() === 'OPEN';
                          const diff = shift.differenceCents;

                          return (
                            <tr
                              key={shift.id}
                              className="hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors"
                            >
                              {/* Kasiyer Adı & Vardiya */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`p-1.5 rounded-xl border ${
                                      isOpen
                                        ? 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
                                        : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                                    }`}
                                  >
                                    <User size={14} />
                                  </div>
                                  <div>
                                    <div className="font-semibold dark:text-white text-zinc-900 flex items-center gap-1.5">
                                      <span>{shift.cashierName}</span>
                                      {isOpen ? (
                                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30">
                                          AÇIK
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                                          KAPANDI
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] dark:text-zinc-500 text-zinc-400 font-mono">
                                      #{shift.id.slice(0, 8)} &bull; {formatDateTime(shift.openedAt)}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Açılış Bakiyesi */}
                              <td className="px-4 py-3.5 whitespace-nowrap font-mono text-zinc-700 dark:text-zinc-300">
                                <div>{formatCurrency(shift.openingBalanceCents)}</div>
                                <div className="text-[10px] text-zinc-400">Devir Tutarı</div>
                              </td>

                              {/* Yapılan Nakit Tahsilatlar */}
                              <td className="px-4 py-3.5 whitespace-nowrap font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                                <div>+{formatCurrency(shift.cashSalesCents)}</div>
                                <div className="text-[10px] text-zinc-400">Satış Tahsilatı</div>
                              </td>

                              {/* Nakit Giriş/Çıkış */}
                              <td className="px-4 py-3.5 whitespace-nowrap font-mono text-zinc-600 dark:text-zinc-400">
                                <div>
                                  {shift.cashMovementNetCents >= 0
                                    ? `+${formatCurrency(shift.cashMovementNetCents)}`
                                    : `-${formatCurrency(Math.abs(shift.cashMovementNetCents))}`}
                                </div>
                                <div className="text-[10px] text-zinc-400">Kasa Hareketi</div>
                              </td>

                              {/* Beklenen Kasa */}
                              <td className="px-4 py-3.5 whitespace-nowrap font-mono font-semibold dark:text-zinc-200 text-zinc-800">
                                <div>{formatCurrency(shift.expectedAmountCents)}</div>
                                <div className="text-[10px] text-zinc-400">Devir+Satış±Hareket</div>
                              </td>

                              {/* Fiili Sayım */}
                              <td className="px-4 py-3.5 whitespace-nowrap font-mono font-bold dark:text-white text-zinc-900">
                                {isOpen ? (
                                  <span className="dark:text-zinc-500 text-zinc-400 font-sans text-xs italic">
                                    Sayım Bekleniyor
                                  </span>
                                ) : shift.actualAmountCents !== null ? (
                                  formatCurrency(shift.actualAmountCents)
                                ) : (
                                  formatCurrency(shift.expectedAmountCents)
                                )}
                              </td>

                              {/* Mutabakat Durumu (Denk / Açık / Fazla) */}
                              <td className="px-4 py-3.5 whitespace-nowrap text-right">
                                {renderMutabakatBadge(shift.status, diff)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] text-center">
                    <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-medium dark:text-zinc-300 text-zinc-700">
                      Bugüne ait açık veya kapanmış vardiya kaydı bulunmuyor.
                    </p>
                    <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">
                      Kasiyerler vardiya açıp sayım yaptıkça kasa mutabakatları bu çizelgede anlık güncellenir.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* SAĞ ALAN: Günün Defter Kapanışı (Mühürleme) — Bağımsız Yüzen Cam Ada */}
            <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-emerald-600 dark:text-emerald-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold dark:text-white text-zinc-900">
                      Günün Defter Kapanışı (Mühürleme)
                    </h2>
                    <p className="text-xs dark:text-zinc-400 text-zinc-500">
                      Güvenli Gün Sonu Kapanışı &bull; Resmî mali kapanış ve Z-Raporu
                    </p>
                  </div>
                </div>

                {/* Açık Masa Kontrol Paneli */}
                {openTables.length > 0 ? (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 mb-4">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                      <div>
                        <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                          Açık Masa Kontrolü: {openTables.length} Adet Açık Masa Bulunuyor!
                        </h4>
                        <p className="text-xs text-amber-700/90 dark:text-amber-300/90 mt-1 leading-relaxed">
                          Henüz hesabı alınmamış masalar:{' '}
                          <span className="font-semibold text-amber-900 dark:text-white">
                            {openTables.map((t) => t.name).slice(0, 4).join(', ')}
                            {openTables.length > 4 ? ` ve +${openTables.length - 4} masa daha` : ''}
                          </span>
                          . Defteri mühürlemeden önce açık hesapların kapatılması önerilir.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs mb-4 flex items-center gap-2">
                    <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Açık Masa Kontrolü: Tüm masalar kapatıldı. Açık masa bulunmuyor.</span>
                  </div>
                )}

                {/* Kasa Teslim Kontrolü & Defter Denetimi */}
                <div className="space-y-2.5 text-xs dark:text-zinc-300 text-zinc-700 mb-6 dark:bg-white/[0.03] bg-white/60 backdrop-blur-md p-4 rounded-2xl border dark:border-white/5 border-black/[0.06]">
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-emerald-500 shrink-0" />
                    <span>
                      <strong>Kasa Teslim Kontrolü:</strong>{' '}
                      {openShifts.length > 0
                        ? `${openShifts.length} açık kasa vardiyası otomatik teslim alınıp kapatılır.`
                        : 'Tüm kasa vardiyaları teslim alındı ve kapandı.'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-emerald-500 shrink-0" />
                    <span>
                      <strong>Nakit Teslimi:</strong> Kasadaki {formatCurrency(cashTotal)} fiziki nakit mühürlenir.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check size={14} className="text-emerald-500 shrink-0" />
                    <span>
                      <strong>Mali Z-Raporu:</strong> Mali Z-Raporu otomatik üretilir ve arşive işlenir.
                    </span>
                  </div>
                </div>

                {/* Son Kapanış Bilgisi (Varsa) */}
                {lastClosedResult && (
                  <div className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-700 dark:text-emerald-300">
                    <p className="font-semibold flex items-center gap-1.5 mb-0.5 text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 size={14} /> Son Defter Kapanışı Tamamlandı
                    </p>
                    <p className="text-[11px] dark:text-zinc-300 text-zinc-700">{lastClosedResult.message}</p>
                    <p className="text-[10px] dark:text-zinc-400 text-zinc-500 mt-1">
                      Kapanış Saati:{' '}
                      {formatDateTime(lastClosedResult.closedAt || lastClosedResult.closed_at)}
                    </p>
                  </div>
                )}
              </div>

              {/* Mühürleme Aksiyon Butonları — Bağımsız Cam Butonlar */}
              <div className="space-y-3 pt-4 border-t dark:border-white/10 border-black/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowConfirmCloseModal(true)}
                  disabled={isClosingDay}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 backdrop-blur-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 size={18} />
                  <span>Günü Kapat ve Z-Raporu Üret</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedZReportShift(null);
                    setShowZReportModal(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.03] hover:dark:bg-white/[0.1] hover:bg-black/[0.06] dark:text-white text-zinc-800 border dark:border-white/10 border-black/[0.08] backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  <FileText size={14} />
                  <span>Z-Raporu Önizleme & Fiş Yazdır</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEKME 2: GEÇMİŞ DEFTER KAYITLARI (ARŞİV) */}
      {activeTab === 'GECMIS_ARSIV' && (
        <div className="space-y-4">
          {/* Arama ve Filtreleme — Bağımsız Yüzen Cam Ada */}
          <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 p-5 rounded-3xl border dark:border-white/10 border-black/[0.08] shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 dark:text-zinc-400 text-zinc-500" />
              <input
                type="text"
                placeholder="Kasiyer adı veya vardiya koduna göre ara..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/10 rounded-2xl pl-10 pr-4 py-2.5 text-sm dark:text-white text-zinc-900 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-[#007AFF]/60"
              />
            </div>

            <button
              type="button"
              onClick={() => loadHistoryData()}
              disabled={historyLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
              <span>Arşivi Yenile</span>
            </button>
          </div>

          {/* Arşiv Tablosu — Bağımsız Yüzen Cam Ada */}
          <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 rounded-3xl border dark:border-white/10 border-black/[0.08] shadow-xl overflow-hidden">
            {historyLoading ? (
              <div className="p-12 text-center dark:text-zinc-400 text-zinc-500">
                <RefreshCw size={28} className="animate-spin text-[#007AFF] mx-auto mb-2" />
                <p className="text-sm font-medium">Geçmiş Z-Raporları getiriliyor...</p>
              </div>
            ) : filteredHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm dark:text-zinc-300 text-zinc-700">
                  <thead className="dark:bg-white/[0.03] bg-black/[0.02] text-xs font-semibold uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
                    <tr>
                      <th className="px-6 py-4">Kapanış Tarihi</th>
                      <th className="px-6 py-4">Kasiyer / Yetkili</th>
                      <th className="px-6 py-4">Durum</th>
                      <th className="px-6 py-4">Açılış Kasası</th>
                      <th className="px-6 py-4">Kapanış / Sayım</th>
                      <th className="px-6 py-4">Kasa Farkı Uyarısı</th>
                      <th className="px-6 py-4 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                    {filteredHistory.map((item) => {
                      const diff = getDifferenceCents(item);
                      const isClosed = item.status?.toUpperCase() === 'CLOSED';

                      return (
                        <tr key={item.id} className="hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium dark:text-white text-zinc-900">
                              {formatDateTime(getClosedAt(item) || getOpenedAt(item))}
                            </div>
                            <div className="text-xs dark:text-zinc-500 text-zinc-500 font-mono">
                              Açılış: {formatDateTime(getOpenedAt(item))}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <User size={15} className="text-[#007AFF]" />
                              <span className="font-medium dark:text-white text-zinc-900">
                                {getCashierName(item)}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400">
                              ID: {item.id.slice(0, 8)}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {isClosed ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                                Kapandı
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                                Açık
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap font-mono dark:text-zinc-300 text-zinc-700">
                            {formatCurrency(getExpectedCents(item))}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap font-mono font-semibold dark:text-white text-zinc-900">
                            {getActualCents(item) !== null
                              ? formatCurrency(getActualCents(item))
                              : '-'}
                          </td>

                          {/* Kasa Farkı Uyarısı */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            {renderMutabakatBadge(item.status, diff)}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedZReportShift(item);
                                setShowZReportModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 text-xs font-medium border dark:border-white/15 border-black/10 transition-colors cursor-pointer shadow-sm"
                            >
                              <FileText size={14} />
                              <span>Z-Raporu İncele</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePrintZReport(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 text-xs font-medium border dark:border-white/15 border-black/10 transition-colors cursor-pointer shadow-sm"
                              title="Termal Fiş Tekrar Yazdır"
                            >
                              <Printer size={14} />
                              <span>Yazdır</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center dark:text-zinc-400 text-zinc-500">
                <Calendar size={36} className="dark:text-zinc-600 text-zinc-400 mx-auto mb-3" />
                <p className="text-base font-semibold dark:text-zinc-300 text-zinc-700">
                  Geçmiş Defter Kaydı Bulunamadı
                </p>
                <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">
                  Kapatılan gün sonu defterleri ve Z-raporları otomatik olarak burada arşivlenir.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEKME 3: CARİ REHBERLER (5 REHBER) */}
      {activeTab === 'CARI_REHBERLER' && (
        <DirectoriesTab />
      )}

      {/* SEKME 4: BORÇ & ALACAK BİLANÇO */}
      {activeTab === 'BORC_ALACAK' && (
        <DebtsBalanceTab />
      )}

      {/* SEKME 5: GİDER DEFTERİ */}
      {activeTab === 'GIDER_DEFTERI' && (
        <ExpensesTab onOpenNewExpense={() => setQuickModalType('GIDER')} />
      )}

      {/* SEKME 6: FİNANSAL RAPORLAR (P&L) */}
      {canSeeFinancialReports && activeTab === 'FINANSAL_RAPORLAR' && (
        <FinancialReportsTab />
      )}

      {/* GÜVENLİ GÜNÜ KAPATMA & DEFTER MÜHÜRLEME ONAY MODALI */}
      {showConfirmCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center dark:bg-black/80 bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="backdrop-blur-2xl dark:bg-[#060609]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] max-w-lg w-full rounded-3xl shadow-2xl overflow-hidden">
            {/* Modal Başlığı */}
            <div className="flex items-center justify-between p-6 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl border border-amber-500/20">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h3 className="text-base font-semibold dark:text-white text-zinc-900">Günü Kapatmayı Onayla</h3>
                  <p className="text-xs dark:text-zinc-400 text-zinc-500">Hesap defteri mutabakatı ve Z-Raporu mühürleme</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmCloseModal(false)}
                className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Gövdesi */}
            <div className="p-6 space-y-4">
              {/* Açık Masa Uyarısı */}
              {openTables.length > 0 && (
                <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-1">
                  <p className="font-semibold text-xs flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                    <AlertTriangle size={15} /> Dikkat: {openTables.length} Adet Açık Masa Bulunuyor!
                  </p>
                  <p className="text-xs leading-relaxed">
                    Masalar:{' '}
                    <span className="font-semibold dark:text-white text-zinc-900">
                      {openTables.map((t) => t.name).join(', ')}
                    </span>
                    . Açık masalar varken defteri mühürlerseniz, bu masaların hesapları devreden bakiye olarak kalır.
                  </p>
                </div>
              )}

              {/* Kapanış Finansal Özeti */}
              <div className="dark:bg-white/[0.03] bg-white/70 backdrop-blur-md p-4 rounded-2xl border dark:border-white/10 border-black/[0.06] space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="dark:text-zinc-400 text-zinc-600">Kapatılacak Açık Vardiyalar:</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono">
                    {openShifts.length > 0 ? `${openShifts.length} Adet Vardiya` : 'Açık Vardiya Yok'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="dark:text-zinc-400 text-zinc-600">Kasadaki Fiziki Nakit:</span>
                  <span className="font-semibold dark:text-white text-zinc-900 font-mono">{formatCurrency(cashTotal)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="dark:text-zinc-400 text-zinc-600">Kredi Kartı / POS Toplamı:</span>
                  <span className="font-semibold dark:text-white text-zinc-900 font-mono">{formatCurrency(cardTotal)}</span>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t dark:border-white/10 border-black/[0.06] text-base font-semibold">
                  <span className="dark:text-zinc-200 text-zinc-800">Günlük Net Ciro:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(totalRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Modal Butonları */}
            <div className="flex items-center justify-end gap-3 p-6 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
              <button
                type="button"
                onClick={() => setShowConfirmCloseModal(false)}
                disabled={isClosingDay}
                className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-zinc-200 text-zinc-700 transition-all cursor-pointer"
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={handleCloseDay}
                disabled={isClosingDay}
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 backdrop-blur-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                {isClosingDay ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Defter Mühürleniyor...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Onayla ve Günü Kapat</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MALİ Z-RAPORU ÖNİZLEME & TERMAL BASKI MODALI */}
      {showZReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center dark:bg-black/85 bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="backdrop-blur-2xl dark:bg-[#060609]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] max-w-md w-full rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Üstü */}
            <div className="flex items-center justify-between p-5 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
              <div>
                <h3 className="text-base font-semibold dark:text-white text-zinc-900">Mali Z-Raporu Önizleme</h3>
                <p className="text-xs dark:text-zinc-400 text-zinc-500">
                  {selectedZReportShift
                    ? `Vardiya Z-Raporu: ${selectedZReportShift.id.slice(0, 8)}`
                    : 'Günün Hesap Defteri Mali Belgesi'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowZReportModal(false)}
                className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Termal Fiş Görünümü */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="bg-white text-zinc-900 font-mono text-xs p-6 rounded-2xl shadow-2xl border border-zinc-200 space-y-3">
                {/* Fiş Başlığı */}
                <div className="text-center space-y-1 pb-3 border-b-2 border-dashed border-zinc-300">
                  <p className="text-base font-black tracking-wider">KASAM360 POS SİSTEMİ</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-zinc-700">
                    {selectedZReportShift ? 'VARDİYA MALİ Z-RAPORU' : 'GÜNÜN HESAP DEFTERİ MALİ Z-RAPORU'}
                  </p>
                  <p className="text-[11px] text-zinc-500">Şube: {tenantId}</p>
                  <p className="text-[11px] text-zinc-500">
                    Yetkili:{' '}
                    {selectedZReportShift ? getCashierName(selectedZReportShift) : actorName} (
                    {actorRole})
                  </p>
                </div>

                {/* Tarih ve Rapor No */}
                <div className="py-2 space-y-1 border-b border-dashed border-zinc-200 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-600">Rapor Tarihi:</span>
                    <span className="font-semibold">
                      {formatDateTime(
                        selectedZReportShift
                          ? getClosedAt(selectedZReportShift) || getOpenedAt(selectedZReportShift)
                          : new Date().toISOString()
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-600">Z-Rapor No:</span>
                    <span className="font-semibold font-mono">
                      {selectedZReportShift
                        ? `Z-VARD-${selectedZReportShift.id.slice(0, 8).toUpperCase()}`
                        : `Z-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`}
                    </span>
                  </div>
                </div>

                {/* Vardiya veya Günlük Kapanış Detayları */}
                {selectedZReportShift ? (
                  <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                    <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                      --- VARDİYA VE KASA MUTABAKATI ---
                    </p>
                    <div className="flex justify-between">
                      <span className="text-zinc-700">Açılış Zamanı:</span>
                      <span className="font-medium">{formatDateTime(getOpenedAt(selectedZReportShift))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-700">Kapanış Zamanı:</span>
                      <span className="font-medium">
                        {formatDateTime(getClosedAt(selectedZReportShift) || 'Açık')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-700">Açılış Kasası:</span>
                      <span className="font-bold">{formatCurrency(getExpectedCents(selectedZReportShift))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-700">Sayılan / Kapanış Kasası:</span>
                      <span className="font-bold">
                        {formatCurrency(
                          getActualCents(selectedZReportShift) ?? getExpectedCents(selectedZReportShift)
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-black pt-1 border-t border-zinc-200">
                      <span>KASA FARKI (FARK):</span>
                      <span
                        className={
                          getDifferenceCents(selectedZReportShift)
                            ? 'text-amber-700 font-bold'
                            : 'text-emerald-700'
                        }
                      >
                        {getDifferenceCents(selectedZReportShift)
                          ? formatCurrency(getDifferenceCents(selectedZReportShift))
                          : '₺0,00 (Kasa Denk)'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Ciro ve Fiş Detayları */}
                    <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                      <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                        --- SATIŞ VE CİRO ÖZETİ ---
                      </p>
                      <div className="flex justify-between">
                        <span className="text-zinc-700">Toplam Adisyon / Fiş:</span>
                        <span className="font-bold">{totalOrders} Adet</span>
                      </div>
                      <div className="flex justify-between text-sm font-black pt-1 border-t border-zinc-200">
                        <span>GÜNLÜK NET CİRO:</span>
                        <span>{formatCurrency(totalRevenue)}</span>
                      </div>
                    </div>

                    {/* Ödeme Dağılımı */}
                    <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                      <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                        --- ÖDEME DAĞILIMI ---
                      </p>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-700">Fiziki Nakit Kasası:</span>
                        <span className="font-bold">{formatCurrency(cashTotal)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-700">Kredi Kartı / POS:</span>
                        <span className="font-bold">{formatCurrency(cardTotal)}</span>
                      </div>
                      {otherTotal > 0 && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-700">Diğer / Yemek Kartı:</span>
                          <span className="font-bold">{formatCurrency(otherTotal)}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Dipnot Bilgisi */}
                <div className="pt-2 text-center space-y-0.5 text-[9px] text-zinc-500">
                  <p className="font-bold tracking-wider">MALİ DEĞERİ YOKTUR - BİLGİ AMAÇLIDIR</p>
                  <p>Kasam360 Bulut Entegre Restoran Çözümleri</p>
                  <p className="text-[9px] text-emerald-700 font-bold">
                    *** {selectedZReportShift ? 'VARDİYA RAPORU ONAYLANDI' : 'HESAP DEFTERİ ONAYLANDI VE MÜHÜRLENDİ'} ***
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Butonları */}
            <div className="flex items-center justify-between p-5 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
              <button
                type="button"
                onClick={() => setShowZReportModal(false)}
                className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-zinc-200 text-zinc-700 transition-all cursor-pointer"
              >
                Kapat
              </button>

              <button
                type="button"
                onClick={() => handlePrintZReport(selectedZReportShift)}
                disabled={isPrinting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 shadow-md backdrop-blur-xl transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                <Printer size={15} className={isPrinting ? 'animate-bounce text-zinc-400' : ''} />
                <span>{isPrinting ? 'Yazdırılıyor...' : 'Termal Yazıcıya Gönder'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 4 HIZLI İŞLEM MODALI (GELİR, GİDER, BORÇ, ALACAK) */}
      {quickModalType && (
        <QuickTransactionModal
          type={quickModalType}
          isOpen={true}
          onClose={() => setQuickModalType(null)}
          onSuccess={() => {
            loadDailyData(true);
            addToast('İşlem başarıyla kaydedildi.', 'success');
          }}
        />
      )}
    </div>
  );
};
