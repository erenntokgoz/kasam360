import { useEffect, useState, useMemo } from 'react';
import {
  Clock,
  TrendingUp,
  CreditCard,
  ShoppingCart,
  Banknote,
  RefreshCw,
  Printer,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  ShieldAlert,
  Calendar,
  User,
  Layers,
  Receipt,
  Search,
  Check,
} from 'lucide-react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';

export interface DailySummaryDto {
  total_revenue_cents: number;
  total_orders: number;
  payment_methods: Record<string, number>;
}

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
}

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
}

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

type TabType = 'GENEL_BAKIS' | 'Z_RAPORU' | 'GECMIS';

export function EndOfDayContainer() {
  const user = useAuthStore((state) => state.user);
  const actorRole = user?.role ?? 'Cashier';
  const actorName = user?.name ?? 'Yetkili';
  const tenantId = user?.tenantId ?? 'DEFAULT_TENANT';

  // Data states
  const [summary, setSummary] = useState<DailySummaryDto | null>(null);
  const [openShifts, setOpenShifts] = useState<OpenShiftDto[]>([]);
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryDto[]>([]);

  // UI / Action states
  const [activeTab, setActiveTab] = useState<TabType>('GENEL_BAKIS');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals & Sub-actions
  const [showConfirmCloseModal, setShowConfirmCloseModal] = useState(false);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ShiftHistoryDto | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [lastClosedResult, setLastClosedResult] = useState<CloseDayResultDto | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    try {
      useToast.add({ title: msg, type });
    } catch {
      console.log(`[Toast] ${type}: ${msg}`);
    }
  };

  // Formatters
  const formatCurrency = (cents: number | undefined | null) => {
    const safeCents = typeof cents === 'number' && !isNaN(cents) ? cents : 0;
    return (safeCents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    });
  };

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

  const formatPaymentMethodName = (method: string) => {
    const key = method.toLowerCase();
    if (key === 'nakit' || key === 'cash') return 'Nakit';
    if (key === 'kredi_karti' || key === 'credit_card' || key === 'kart') return 'Kredi Kartı';
    if (key === 'yemek_karti' || key === 'ticket' || key === 'sodexo' || key === 'multinet') return 'Yemek Kartı';
    if (key === 'acik_hesap' || key === 'cari') return 'Açık Hesap (Cari)';
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  // Field extraction helpers (supporting both camelCase and snake_case)
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

  // Initial and refreshed data loader
  const loadDailyData = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Fetch daily summary
      const summaryData = await invoke<DailySummaryDto>('get_daily_summary', { actorRole });
      setSummary(summaryData);

      // 2. Fetch active open shifts
      try {
        const shifts = await invoke<OpenShiftDto[]>('get_open_shifts', { actorRole });
        setOpenShifts(Array.isArray(shifts) ? shifts : []);
      } catch (err) {
        console.warn('Could not load open shifts (might be unauthorized or empty):', err);
        setOpenShifts([]);
      }

      if (isManualRefresh) {
        addToast('Güncel veriler başarıyla yenilendi.', 'info');
      }
    } catch (e) {
      console.error('Failed to fetch daily summary:', e);
      setError(String(e));
      addToast('Gün sonu verileri alınırken bir hata oluştu.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load past closures / shift history
  const loadHistoryData = async () => {
    setHistoryLoading(true);
    try {
      const hist = await invoke<ShiftHistoryDto[]>('get_shift_history', { cashierId: 'ALL' });
      setShiftHistory(Array.isArray(hist) ? hist : []);
    } catch (err) {
      console.error('Failed to load shift history:', err);
      addToast('Kapanış geçmişi yüklenirken hata oluştu.', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadDailyData();
    loadHistoryData();
  }, [actorRole]);

  useEffect(() => {
    if (activeTab === 'GECMIS') {
      loadHistoryData();
    }
  }, [activeTab]);

  // Execute End of Day close workflow
  const handleCloseDay = async () => {
    setIsClosingDay(true);
    try {
      const result = await invoke<CloseDayResultDto>('close_day', {
        actorRole,
        actorId: user?.userId,
      });

      setLastClosedResult(result);
      setShowConfirmCloseModal(false);
      addToast(result?.message || 'Gün sonu başarıyla kapatıldı.', 'success');

      // Refresh both daily stats and history
      await loadDailyData(true);
      await loadHistoryData();

      // Switch to Z-Report tab to immediately display the resulting Z-Report
      setActiveTab('Z_RAPORU');
    } catch (e) {
      console.error('Failed to close day:', e);
      addToast(`Gün sonu kapatılamadı: ${String(e)}`, 'error');
    } finally {
      setIsClosingDay(false);
    }
  };

  // Print Z-Report via ESC/POS thermal printer (print_receipt command)
  const handlePrintZReport = async (shiftOverride?: ShiftHistoryDto | null) => {
    setIsPrinting(true);

    try {
      const nowIso = new Date().toISOString();
      const reportDate = new Date();
      const dateKey = `${reportDate.getFullYear()}${String(reportDate.getMonth() + 1).padStart(2, '0')}${String(
        reportDate.getDate()
      ).padStart(2, '0')}`;
      const reportId = shiftOverride
        ? `Z-VARD-${shiftOverride.id.slice(0, 8).toUpperCase()}`
        : `Z-${dateKey}-${String(Date.now()).slice(-4)}`;

      // Construct receipt payload for printer
      const receiptOrder = {
        type: 'Z_REPORT',
        reportNumber: reportId,
        reportTitle: 'GÜN SONU MALİ Z-RAPORU',
        tenantId,
        printedAt: nowIso,
        cashier: shiftOverride ? getCashierName(shiftOverride) : actorName,
        role: actorRole,
        totalRevenueCents: shiftOverride
          ? (getActualCents(shiftOverride) ?? getExpectedCents(shiftOverride))
          : (summary?.total_revenue_cents || 0),
        totalOrders: shiftOverride ? 1 : (summary?.total_orders || 0),
        paymentMethods: shiftOverride
          ? {
              nakit: getActualCents(shiftOverride) ?? getExpectedCents(shiftOverride),
            }
          : (summary?.payment_methods || {}),
        shiftSummary: shiftOverride
          ? {
              shiftId: shiftOverride.id,
              openedAt: getOpenedAt(shiftOverride),
              closedAt: getClosedAt(shiftOverride),
              openingBalanceCents: getExpectedCents(shiftOverride),
              closingBalanceCents: getActualCents(shiftOverride),
              differenceCents: getDifferenceCents(shiftOverride),
            }
          : {
              activeShiftsCount: openShifts.length,
              status: lastClosedResult ? 'KAPATILDI' : 'GÜNCEL_DURUM',
            },
      };

      await invoke('print_receipt', { order: receiptOrder });
      addToast('Z-Raporu başarıyla fiş yazıcısına gönderildi.', 'success');
    } catch (e) {
      console.error('Failed to print Z-Report:', e);
      addToast('Yazıcıya gönderme başarısız oldu.', 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  // Calculations for summary stats
  const totalRevenue = summary?.total_revenue_cents || 0;
  const totalOrders = summary?.total_orders || 0;
  const averageOrderCents = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const paymentMethodsList = useMemo(() => {
    if (!summary?.payment_methods) return [];
    const entries = Object.entries(summary.payment_methods);
    return entries.map(([method, amount]) => {
      const percentage = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
      return {
        method,
        label: formatPaymentMethodName(method),
        amount,
        percentage,
      };
    });
  }, [summary, totalRevenue]);

  // Filtered history list
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

  // Loading skeleton screen
  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-slate-200">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent shadow-lg" />
          <p className="text-slate-400 font-medium tracking-wide">Gün Sonu verileri yükleniyor...</p>
        </div>
      </div>
    );
  }

  // Error screen with retry
  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-slate-200 p-8">
        <div className="max-w-md w-full bg-slate-800 border border-red-500/30 rounded-2xl p-6 text-center shadow-2xl">
          <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Veri Yüklenemedi</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => loadDailyData()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 transition-colors shadow-lg"
          >
            <RefreshCw size={18} />
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-900 text-slate-200 p-6 md:p-8 overflow-y-auto">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Clock size={28} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                Gün Sonu & Kasa Kapanış
              </h1>
              <p className="text-sm text-slate-400">
                Günlük ciro, sipariş analizleri, aktif açık vardiyalar ve mali Z-Raporu yönetimi
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => loadDailyData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors border border-slate-700 disabled:opacity-50"
            title="Verileri Yenile"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Yenile</span>
          </button>

          <button
            onClick={() => setActiveTab('Z_RAPORU')}
            className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors border border-slate-700 shadow-sm"
          >
            <FileText size={16} className="text-indigo-400" />
            <span>Z-Raporu Gör</span>
          </button>

          <button
            onClick={() => setShowConfirmCloseModal(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-5 py-2.5 text-sm font-bold text-white transition-all shadow-lg shadow-indigo-600/30 active:scale-95"
          >
            <CheckCircle2 size={18} />
            <span>Gün Sonunu Kapat</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 mb-6 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('GENEL_BAKIS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'GENEL_BAKIS'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Layers size={16} />
          <span>Genel Bakış & Açık Vardiyalar</span>
          {openShifts.length > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {openShifts.length} Açık
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('Z_RAPORU')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'Z_RAPORU'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Receipt size={16} />
          <span>Gün Sonu Z-Raporu (Fiş)</span>
        </button>

        <button
          onClick={() => setActiveTab('GECMIS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'GECMIS'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Calendar size={16} />
          <span>Kapanış Raporları Geçmişi</span>
          {shiftHistory.length > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300">
              {shiftHistory.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: GENEL BAKIŞ & AÇIK VARDİYALAR */}
      {activeTab === 'GENEL_BAKIS' && (
        <div className="space-y-6">
          {/* Key Metric Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Stat 1: Toplam Ciro */}
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Günlük Toplam Ciro
                </p>
                <p className="text-2xl md:text-3xl font-extrabold text-white">
                  {formatCurrency(totalRevenue)}
                </p>
                <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1 font-medium">
                  <TrendingUp size={14} /> Tamamlanan siparişler
                </p>
              </div>
              <div className="p-3.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
                <TrendingUp size={28} />
              </div>
            </div>

            {/* Stat 2: Toplam Sipariş */}
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Toplam Sipariş / Fiş
                </p>
                <p className="text-2xl md:text-3xl font-extrabold text-white">{totalOrders}</p>
                <p className="text-xs text-blue-400 flex items-center gap-1 mt-1 font-medium">
                  <ShoppingCart size={14} /> Adet satış işlemi
                </p>
              </div>
              <div className="p-3.5 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20">
                <ShoppingCart size={28} />
              </div>
            </div>

            {/* Stat 3: Ortalama Fiş */}
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Ortalama Fiş Tutarı
                </p>
                <p className="text-2xl md:text-3xl font-extrabold text-white">
                  {formatCurrency(averageOrderCents)}
                </p>
                <p className="text-xs text-indigo-400 flex items-center gap-1 mt-1 font-medium">
                  <Receipt size={14} /> Sipariş başına düşen ciro
                </p>
              </div>
              <div className="p-3.5 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
                <Receipt size={28} />
              </div>
            </div>

            {/* Stat 4: Açık Vardiya Sayısı */}
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Aktif Açık Vardiyalar
                </p>
                <p className="text-2xl md:text-3xl font-extrabold text-white">{openShifts.length}</p>
                <p className="text-xs text-amber-400 flex items-center gap-1 mt-1 font-medium">
                  <Clock size={14} /> Kapanış bekleyen kasalar
                </p>
              </div>
              <div className="p-3.5 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
                <Clock size={28} />
              </div>
            </div>
          </div>

          {/* Section: Open Shifts & Close Day Readiness */}
          <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
                  <Clock size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Açık Kasa Vardiyaları (Kapanış Öncesi Durum)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Gün sonu alındığında aşağıdaki tüm aktif açık vardiyalar otomatik sonlandırılacaktır.
                  </p>
                </div>
              </div>

              {openShifts.length > 0 && (
                <span className="px-3 py-1 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 self-start sm:self-auto">
                  {openShifts.length} Kasa Açık
                </span>
              )}
            </div>

            {openShifts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                {openShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60 hover:border-slate-600 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <User size={16} className="text-indigo-400" />
                          <span className="font-semibold text-white text-sm">
                            {getCashierName(shift)}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          AÇIK
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-1">
                        Açılış Saati:{' '}
                        <span className="text-slate-300 font-medium">
                          {formatDateTime(getOpenedAt(shift))}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">
                        Vardiya ID: <span className="font-mono text-slate-400">{shift.id.slice(0, 8)}...</span>
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400">Açılış Kasası:</span>
                      <span className="text-sm font-bold text-white font-mono">
                        {formatCurrency(getExpectedCents(shift))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-slate-900/40 border border-dashed border-slate-700 text-center">
                <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">
                  Şu anda açık kalan kasiyer vardiyası bulunmuyor.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Tüm kasalar kapalı ve gün sonu kapanışı için hazır.
                </p>
              </div>
            )}
          </div>

          {/* Section: Payment Method Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Payment Distribution */}
            <div className="lg:col-span-2 bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
                    <CreditCard size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Ödeme Yöntemleri Dağılımı</h2>
                    <p className="text-xs text-slate-400">
                      Nakit, kredi kartı ve diğer kanallardan gerçekleşen tahsilat özetleri
                    </p>
                  </div>
                </div>
              </div>

              {paymentMethodsList.length > 0 ? (
                <div className="space-y-4">
                  {paymentMethodsList.map((item) => (
                    <div
                      key={item.method}
                      className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/60"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {item.method.toLowerCase().includes('nakit') ? (
                            <Banknote size={18} className="text-emerald-400" />
                          ) : (
                            <CreditCard size={18} className="text-indigo-400" />
                          )}
                          <span className="font-semibold text-white text-sm">{item.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-white font-mono">
                            {formatCurrency(item.amount)}
                          </span>
                          <span className="text-xs text-slate-400 ml-2">({item.percentage}%)</span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            item.method.toLowerCase().includes('nakit')
                              ? 'bg-emerald-500'
                              : 'bg-indigo-500'
                          }`}
                          style={{ width: `${Math.max(item.percentage, 3)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-900/40 rounded-xl border border-dashed border-slate-700">
                  <CreditCard size={32} className="text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm italic">Bugüne ait ödeme kaydı bulunmuyor.</p>
                </div>
              )}
            </div>

            {/* End of Day Execution Box */}
            <div className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/80 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
                    <ShieldAlert size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Mali Kapanış & Z-Raporu</h2>
                    <p className="text-xs text-slate-400">Kesin gün sonu işlemi</p>
                  </div>
                </div>

                <div className="space-y-3 text-xs text-slate-300 mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700/60">
                  <div className="flex items-start gap-2">
                    <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Açık olan tüm kasa vardiyaları sonlandırılır.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Günlük satış ve hasılat verileri kilitlenir.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span>Mali Z-Raporu oluşturulur ve yazdırılmaya hazır hale gelir.</span>
                  </div>
                </div>

                {lastClosedResult && (
                  <div className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      <CheckCircle2 size={14} /> Son Kapanış Başarılı
                    </p>
                    <p>{lastClosedResult.message}</p>
                    <p className="text-slate-400 mt-1">
                      Zaman: {formatDateTime(lastClosedResult.closedAt || lastClosedResult.closed_at)}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-700/80">
                <button
                  onClick={() => setShowConfirmCloseModal(true)}
                  disabled={isClosingDay}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-4 py-3.5 text-sm font-bold text-white transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50 active:scale-98"
                >
                  <CheckCircle2 size={18} />
                  <span>Gün Sonunu Kapat ve Onayla</span>
                </button>

                <button
                  onClick={() => setActiveTab('Z_RAPORU')}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-700/60 hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-300 transition-colors"
                >
                  <FileText size={16} />
                  <span>Z-Raporu Önizlemesine Git</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GÜN SONU Z-RAPORU ÖNİZLEME & YAZDIRMA */}
      {activeTab === 'Z_RAPORU' && (
        <div className="flex flex-col items-center justify-center py-4">
          <div className="w-full max-w-lg">
            {/* Action Bar for Printing */}
            <div className="flex items-center justify-between gap-4 mb-4 bg-slate-800/90 p-4 rounded-xl border border-slate-700 shadow-md">
              <div>
                <h3 className="text-sm font-bold text-white">Mali Z-Raporu Önizleme</h3>
                <p className="text-xs text-slate-400">80mm Termal ESC/POS Fiş Görünümü</p>
              </div>
              <button
                onClick={() => handlePrintZReport()}
                disabled={isPrinting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-sm text-white shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 active:scale-95"
              >
                <Printer size={18} className={isPrinting ? 'animate-bounce' : ''} />
                <span>{isPrinting ? 'Yazdırılıyor...' : 'Z-Raporu Yazdır'}</span>
              </button>
            </div>

            {/* Thermal Receipt Styled Paper */}
            <div className="bg-white text-slate-900 font-mono text-xs rounded-xl shadow-2xl p-6 border-4 border-slate-800 selection:bg-slate-300">
              {/* Receipt Header */}
              <div className="text-center space-y-1 pb-4 border-b-2 border-dashed border-slate-400">
                <p className="text-base font-black tracking-wider">KASAM360 POS SİSTEMİ</p>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-700">
                  GÜN SONU MALİ Z-RAPORU
                </p>
                <p className="text-[11px] text-slate-500">Şube: {tenantId}</p>
                <p className="text-[11px] text-slate-500">Yetkili: {actorName} ({actorRole})</p>
              </div>

              {/* Date & Meta Info */}
              <div className="py-3 space-y-1 border-b border-dashed border-slate-300 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-600">Rapor Tarihi:</span>
                  <span className="font-semibold">{formatDateTime(new Date().toISOString())}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Z-Raporu No:</span>
                  <span className="font-semibold">
                    Z-{new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Açık Vardiyalar:</span>
                  <span className="font-semibold">{openShifts.length} Adet</span>
                </div>
              </div>

              {/* Sales & Revenue Breakdown */}
              <div className="py-3 space-y-1.5 border-b border-dashed border-slate-300">
                <p className="font-bold text-center text-slate-800 text-[11px] tracking-wide mb-1">
                  --- SATIŞ VE CİRO ÖZETİ ---
                </p>
                <div className="flex justify-between">
                  <span className="text-slate-700">Toplam Fiş Adedi:</span>
                  <span className="font-bold">{totalOrders}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">Ortalama Fiş Tutarı:</span>
                  <span className="font-semibold">{formatCurrency(averageOrderCents)}</span>
                </div>
                <div className="flex justify-between text-sm font-black pt-1 border-t border-slate-200">
                  <span>TOPLAM CİRO:</span>
                  <span>{formatCurrency(totalRevenue)}</span>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="py-3 space-y-1.5 border-b border-dashed border-slate-300">
                <p className="font-bold text-center text-slate-800 text-[11px] tracking-wide mb-1">
                  --- ÖDEME DAĞILIMI ---
                </p>
                {paymentMethodsList.length > 0 ? (
                  paymentMethodsList.map((pm) => (
                    <div key={pm.method} className="flex justify-between text-[11px]">
                      <span className="text-slate-700">{pm.label}:</span>
                      <span className="font-bold">
                        {formatCurrency(pm.amount)} ({pm.percentage}%)
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-slate-400 italic text-[11px]">Ödeme kaydı yok</p>
                )}
              </div>

              {/* Cash Movement & Drawer Balance */}
              <div className="py-3 space-y-1 border-b-2 border-dashed border-slate-400 text-[11px]">
                <p className="font-bold text-center text-slate-800 text-[11px] tracking-wide mb-1">
                  --- KASA NAKİT DURUMU ---
                </p>
                <div className="flex justify-between">
                  <span className="text-slate-600">Nakit Satışlar:</span>
                  <span className="font-semibold">
                    {formatCurrency(summary?.payment_methods?.['nakit'] || summary?.payment_methods?.['cash'] || 0)}
                  </span>
                </div>
                <div className="flex justify-between font-bold pt-1 text-slate-800">
                  <span>TOPLAM KASA NAKDİ:</span>
                  <span>
                    {formatCurrency(summary?.payment_methods?.['nakit'] || summary?.payment_methods?.['cash'] || 0)}
                  </span>
                </div>
              </div>

              {/* Footer Notice */}
              <div className="pt-4 text-center space-y-1 text-[10px] text-slate-500">
                <p className="font-bold tracking-wider">MALİ DEĞERİ YOKTUR - BİLGİ AMAÇLIDIR</p>
                <p>Kasam360 Bulut Entegre Restoran Çözümleri</p>
                <p className="text-[9px] text-slate-400">*** GÜN SONU ONAYLANDI ***</p>
              </div>
            </div>

            {/* Secondary Print Help */}
            <div className="text-center mt-4">
              <button
                onClick={() => window.print()}
                className="text-xs text-slate-400 hover:text-slate-200 underline transition-colors"
              >
                Tarayıcı Sistem Yazıcısından Çıktı Al
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: KAPANIŞ RAPORLARI GEÇMİŞİ (get_shift_history) */}
      {activeTab === 'GECMIS' && (
        <div className="space-y-4">
          {/* Filter / Search Bar */}
          <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Kasiyer veya vardiya koduna göre ara..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              onClick={() => loadHistoryData()}
              disabled={historyLoading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-xs font-semibold text-slate-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
              <span>Listeyi Yenile</span>
            </button>
          </div>

          {/* Shift History Table / Card List */}
          <div className="bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-slate-700/80 shadow-lg overflow-hidden">
            {historyLoading ? (
              <div className="p-12 text-center text-slate-400">
                <RefreshCw size={28} className="animate-spin text-indigo-400 mx-auto mb-2" />
                <p className="text-sm font-medium">Geçmiş kapanış kayıtları getiriliyor...</p>
              </div>
            ) : filteredHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-900/60 text-xs font-bold uppercase text-slate-400 border-b border-slate-700/80">
                    <tr>
                      <th className="px-6 py-4">Kapanış Tarihi</th>
                      <th className="px-6 py-4">Kasiyer / Yetkili</th>
                      <th className="px-6 py-4">Durum</th>
                      <th className="px-6 py-4">Açılış Kasası</th>
                      <th className="px-6 py-4">Kapanış / Sayım</th>
                      <th className="px-6 py-4">Kasa Farkı</th>
                      <th className="px-6 py-4 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {filteredHistory.map((item) => {
                      const diff = getDifferenceCents(item);
                      const isClosed = item.status?.toUpperCase() === 'CLOSED';

                      return (
                        <tr key={item.id} className="hover:bg-slate-750/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-semibold text-white">
                              {formatDateTime(getClosedAt(item) || getOpenedAt(item))}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">
                              Açılış: {formatDateTime(getOpenedAt(item))}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <User size={15} className="text-indigo-400" />
                              <span className="font-medium text-slate-200">
                                {getCashierName(item)}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              ID: {item.id.slice(0, 8)}
                            </div>
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {isClosed ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Kapandı
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Açık
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-300">
                            {formatCurrency(getExpectedCents(item))}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap font-mono font-semibold text-white">
                            {getActualCents(item) !== null
                              ? formatCurrency(getActualCents(item))
                              : '-'}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap">
                            {diff === null ? (
                              <span className="text-slate-500">-</span>
                            ) : diff === 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Kasa Denk
                              </span>
                            ) : diff > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                +{formatCurrency(diff)} (Fazla)
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                {formatCurrency(diff)} (Açık)
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                            <button
                              onClick={() => setSelectedHistoryItem(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-colors"
                            >
                              <FileText size={14} />
                              <span>Z-Raporu Gör</span>
                            </button>

                            <button
                              onClick={() => handlePrintZReport(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-colors"
                              title="Yazdır"
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
              <div className="p-12 text-center text-slate-400">
                <Calendar size={36} className="text-slate-600 mx-auto mb-3" />
                <p className="text-base font-semibold text-slate-300">
                  Kapanış geçmişi kaydı bulunamadı.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Yapılan gün sonu ve vardiya kapanışları burada listelenecektir.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: GÜN SONU KAPATMA ONAY MODALI */}
      {showConfirmCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-700/80 bg-slate-900/40">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Gün Sonunu Kapat</h3>
                  <p className="text-xs text-slate-400">Mali kapanış ve açık vardiya sonlandırma</p>
                </div>
              </div>
              <button
                onClick={() => setShowConfirmCloseModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-300 leading-relaxed">
                Bu işlem bugünün tüm açık kasa vardiyalarını kapatacak ve günlük mali Z-raporunu
                oluşturacaktır.
              </p>

              {/* Summary Highlights */}
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60 space-y-2.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Kapanacak Açık Vardiyalar:</span>
                  <span className="font-bold text-amber-400">
                    {openShifts.length > 0 ? `${openShifts.length} Adet Kasa` : 'Açık Kasa Yok'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Toplam Sipariş / Fiş:</span>
                  <span className="font-bold text-white">{totalOrders} Adet</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-base font-bold">
                  <span className="text-slate-300">Toplam Ciro:</span>
                  <span className="text-emerald-400">{formatCurrency(totalRevenue)}</span>
                </div>
              </div>

              {openShifts.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
                  Dikkat: Açık vardiyaların tümü mevcut beklenen bakiyeleriyle kapanacaktır.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700/80 bg-slate-900/40">
              <button
                onClick={() => setShowConfirmCloseModal(false)}
                disabled={isClosingDay}
                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 font-medium text-sm text-slate-200 transition-colors"
              >
                İptal
              </button>

              <button
                onClick={handleCloseDay}
                disabled={isClosingDay}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 active:scale-95"
              >
                {isClosingDay ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Gün Sonu Kapatılıyor...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Onayla ve Gün Sonunu Kapat</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: GEÇMİŞ VARDİYA Z-RAPORU DETAYI */}
      {selectedHistoryItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 max-w-md w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-slate-700 bg-slate-900/60">
              <div>
                <h3 className="text-base font-bold text-white">Geçmiş Z-Raporu Detayı</h3>
                <p className="text-xs text-slate-400 font-mono">
                  {selectedHistoryItem.id.slice(0, 16)}...
                </p>
              </div>
              <button
                onClick={() => setSelectedHistoryItem(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Receipt styled details */}
              <div className="bg-white text-slate-900 font-mono text-xs p-5 rounded-xl shadow-inner border border-slate-300 space-y-2">
                <div className="text-center pb-3 border-b border-dashed border-slate-400">
                  <p className="font-bold text-sm">GÜN SONU / VARDİYA Z-RAPORU</p>
                  <p className="text-[10px] text-slate-600">KASAM360 MALİ BELGE</p>
                </div>

                <div className="space-y-1 text-[11px] py-2 border-b border-dashed border-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Kasiyer:</span>
                    <span className="font-semibold">{getCashierName(selectedHistoryItem)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Açılış:</span>
                    <span>{formatDateTime(getOpenedAt(selectedHistoryItem))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Kapanış:</span>
                    <span>{formatDateTime(getClosedAt(selectedHistoryItem))}</span>
                  </div>
                </div>

                <div className="space-y-1 text-[11px] py-2 border-b border-dashed border-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Açılış Kasası:</span>
                    <span>{formatCurrency(getExpectedCents(selectedHistoryItem))}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Kapanış / Sayım:</span>
                    <span>
                      {getActualCents(selectedHistoryItem) !== null
                        ? formatCurrency(getActualCents(selectedHistoryItem))
                        : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-200">
                    <span>FARK / DISCREPANCY:</span>
                    <span>
                      {getDifferenceCents(selectedHistoryItem) !== null
                        ? formatCurrency(getDifferenceCents(selectedHistoryItem))
                        : '-'}
                    </span>
                  </div>
                </div>

                <div className="text-center pt-2 text-[10px] text-slate-500">
                  Mali değeri yoktur - Arşiv kaydı
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-5 border-t border-slate-700 bg-slate-900/60">
              <button
                onClick={() => setSelectedHistoryItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-slate-200"
              >
                Kapat
              </button>

              <button
                onClick={() => {
                  handlePrintZReport(selectedHistoryItem);
                  setSelectedHistoryItem(null);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md transition-all active:scale-95"
              >
                <Printer size={15} />
                <span>Yazdır</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

