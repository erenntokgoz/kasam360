import { useEffect, useState, useMemo } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import {
  TrendingUp,
  CreditCard,
  Banknote,
  Receipt,
  ShoppingCart,
  Layers,
  Search,
  RefreshCw,
  Printer,
  Eye,
  X,
  PieChart,
} from 'lucide-react';
import { AnalyticsDashboardDataDto } from '../../../types/analytics';

export interface DailySummaryDto {
  total_revenue_cents: number;
  total_orders: number;
  payment_methods: Record<string, number>;
}

export interface ReceiptDto {
  id: string;
  table_id: string;
  total_cents: number;
  created_at: string;
  cashier_id?: string | null;
}

// Apple Borsa / Sağlık tarzı mini trend çizgi grafiği
function MetricMiniSparkline({ color, points }: { color: string; points: string }) {
  // SVG id içerisinde '#' karakteri URL fragment çözümlemesini bozduğu için temizle
  const cleanId = color.replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `sales-grad-${cleanId}`;

  return (
    <div className="h-8 w-full mt-3 overflow-hidden">
      <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 24">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path
          d={`M 0,24 L ${points} L 100,24 Z`}
          fill={`url(#${gradId})`}
        />
        <path
          d={`M ${points}`}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function OwnerSalesTab() {
  const user = useAuthStore(state => state.user);
  const [dailySummary, setDailySummary] = useState<DailySummaryDto | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsDashboardDataDto | null>(null);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Arama ve Seçili Fiş Durumu
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptDto | null>(null);
  const [printStatus, setPrintStatus] = useState<string | null>(null);

  // Satış verilerini yükle
  const fetchSalesData = async (showRefreshState = false) => {
    if (showRefreshState) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    const actorRole = user?.role || 'OWNER';

    try {
      const [summaryRes, analyticsRes, receiptsRes] = await Promise.all([
        invoke<DailySummaryDto>('get_daily_summary', {
          actorRole,
          actor_role: actorRole,
        }).catch(err => {
          console.warn('[SalesTab] get_daily_summary fallback:', err);
          return {
            total_revenue_cents: 0,
            total_orders: 0,
            payment_methods: {},
          };
        }),
        invoke<AnalyticsDashboardDataDto>('get_analytics_dashboard_data', {
          actorRole,
          actor_role: actorRole,
        }).catch(err => {
          console.warn('[SalesTab] get_analytics_dashboard_data fallback:', err);
          return {
            total_sales_cents: 0,
            transaction_count: 0,
            average_order_value_cents: 0,
            popular_categories: {},
          };
        }),
        invoke<ReceiptDto[]>('get_receipts').catch(err => {
          console.warn('[SalesTab] get_receipts fallback:', err);
          return [];
        }),
      ]);

      setDailySummary(summaryRes);
      setAnalytics(analyticsRes);
      setReceipts(receiptsRes);
    } catch (err) {
      console.error('Satış verisi yükleme hatası:', err);
      setErrorMessage(typeof err === 'string' ? err : 'Satış verileri yüklenemedi.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSalesData();
  }, [user]);

  // Escape tuşuna basıldığında açık fiş modalını kapat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedReceipt) {
        setSelectedReceipt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedReceipt]);

  // Fiş yazdırma işlemi
  const handlePrintReceipt = async (receiptId: string) => {
    try {
      setPrintStatus('Yazdırılıyor...');
      await invoke('print_receipt', { orderId: receiptId, order_id: receiptId });
      setPrintStatus('Yazdırma komutu iletildi.');
      setTimeout(() => setPrintStatus(null), 3000);
    } catch (err) {
      console.error('Yazdırma hatası:', err);
      setPrintStatus('Yazdırma hatası: ' + String(err));
      setTimeout(() => setPrintStatus(null), 3500);
    }
  };

  const filteredReceipts = useMemo(() => {
    if (!searchTerm.trim()) return receipts;
    const lower = searchTerm.toLowerCase();
    return receipts.filter(
      r =>
        r.id.toLowerCase().includes(lower) ||
        r.table_id.toLowerCase().includes(lower) ||
        (r.cashier_id && r.cashier_id.toLowerCase().includes(lower))
    );
  }, [receipts, searchTerm]);

  const totalSalesCents =
    dailySummary?.total_revenue_cents ||
    analytics?.total_sales_cents ||
    receipts.reduce((acc, r) => acc + r.total_cents, 0);

  const totalOrdersCount =
    analytics?.transaction_count ||
    dailySummary?.total_orders ||
    receipts.length;

  const averageBasketCents =
    analytics?.average_order_value_cents ||
    (totalOrdersCount > 0 ? Math.round(totalSalesCents / totalOrdersCount) : 0);

  const paymentMethods = dailySummary?.payment_methods || {};
  const totalPaymentMethodsCents = Object.values(paymentMethods).reduce(
    (acc, v) => acc + v,
    0
  );

  const getMethodIcon = (method: string) => {
    const m = method.toLowerCase();
    if (m.includes('nakit') || m.includes('cash')) {
      return <Banknote size={14} className="text-emerald-400" />;
    }
    return <CreditCard size={14} className="text-sky-400" />;
  };

  const getMethodLabel = (method: string) => {
    const m = method.toLowerCase();
    if (m.includes('nakit') || m.includes('cash')) return 'Nakit';
    if (m.includes('kredi') || m.includes('card') || m.includes('kart')) return 'Kredi Kartı';
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500 py-16">
        Satış verileri yükleniyor...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 select-none">
      {/* Üst Başlık & Yenileme */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900 flex items-center gap-2">
            <TrendingUp size={20} className="text-[#007AFF]" />
            Satış & Ciro
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchSalesData(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 dark:bg-white/[0.04] bg-white hover:dark:bg-white/[0.08] hover:bg-zinc-50 border dark:border-white/10 border-black/10 rounded-xl text-xs font-semibold dark:text-zinc-300 text-zinc-800 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-[#007AFF]' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-300 px-4 py-3 rounded-2xl text-xs flex items-center justify-between backdrop-blur-md">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Apple Borsa / Sağlık Metrik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Günlük Ciro */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all flex flex-col justify-between backdrop-blur-2xl shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                Bugünkü Ciro
              </span>
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                <TrendingUp size={14} />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
              <MoneyDisplay amountInCents={totalSalesCents} />
            </div>
          </div>
          <MetricMiniSparkline color="#10b981" points="0,20 20,16 40,19 60,10 80,14 100,4" />
        </div>

        {/* Sipariş Sayısı */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all flex flex-col justify-between backdrop-blur-2xl shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                Sipariş
              </span>
              <div className="w-7 h-7 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[#007AFF]">
                <ShoppingCart size={14} />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
              {totalOrdersCount}
            </div>
          </div>
          <MetricMiniSparkline color="#6366f1" points="0,22 25,15 45,18 65,11 85,7 100,4" />
        </div>

        {/* Ortalama Sepet */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all flex flex-col justify-between backdrop-blur-2xl shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                Ortalama Sepet
              </span>
              <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                <Layers size={14} />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
              <MoneyDisplay amountInCents={averageBasketCents} />
            </div>
          </div>
          <MetricMiniSparkline color="#f59e0b" points="0,18 20,20 45,13 70,16 90,7 100,9" />
        </div>

        {/* Toplam Fiş */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all flex flex-col justify-between backdrop-blur-2xl shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
                Kayıtlı Fiş
              </span>
              <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                <Receipt size={14} />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
              {receipts.length}
            </div>
          </div>
          <MetricMiniSparkline color="#a855f7" points="0,19 30,22 55,14 75,17 90,6 100,5" />
        </div>
      </div>

      {/* Dağılım Kartları: Ödeme Yöntemleri & Popüler Kategoriler */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ödeme Yöntemleri Dağılımı */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-[#007AFF]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Ödeme Yöntemleri
            </h3>
          </div>

          {Object.keys(paymentMethods).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(paymentMethods).map(([method, amountCents]) => {
                const percentage =
                  totalPaymentMethodsCents > 0
                    ? Math.round((amountCents / totalPaymentMethodsCents) * 100)
                    : 0;

                return (
                  <div key={method} className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getMethodIcon(method)}
                        <span className="font-medium text-white text-xs">
                          {getMethodLabel(method)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-zinc-400 font-mono">%{percentage}</span>
                        <span className="font-semibold text-white text-xs">
                          <MoneyDisplay amountInCents={amountCents} />
                        </span>
                      </div>
                    </div>
                    {/* Apple tarzı ince ilerleme çubuğu */}
                    <div className="w-full bg-white/[0.04] rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-[#007AFF] h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, percentage))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs text-center py-6">
              Ödeme kaydı bulunmuyor.
            </div>
          )}
        </div>

        {/* Kategori Satış Hacmi */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <PieChart size={16} className="text-emerald-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Kategori Hacmi
            </h3>
          </div>

          {analytics?.popular_categories && Object.keys(analytics.popular_categories).length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(analytics.popular_categories).map(([catName, count]) => (
                <div
                  key={catName}
                  className="bg-white/[0.02] border border-white/5 rounded-xl p-3 flex flex-col justify-between"
                >
                  <span className="text-[11px] text-zinc-400 truncate" title={catName}>
                    {catName}
                  </span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-xl font-semibold text-white">{count}</span>
                    <span className="text-[10px] text-zinc-500">adet</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-500 text-xs text-center py-6">
              Kategori verisi bulunmuyor.
            </div>
          )}
        </div>
      </div>

      {/* Apple Minimalist Fiş Tablosu (1px white/5 ayırıcılar & ferah aralıklar) */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-[#007AFF]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Fiş Geçmişi
            </h3>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Fiş, masa veya kasiyer ara..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3.5 py-1.5 bg-white/[0.03] border border-white/5 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>

        {printStatus && (
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-zinc-200 text-xs flex items-center gap-2">
            <Printer size={14} className="text-[#007AFF]" />
            <span>{printStatus}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 text-zinc-400 font-medium uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Fiş No</th>
                <th className="py-3 px-4">Masa</th>
                <th className="py-3 px-4">Kasiyer</th>
                <th className="py-3 px-4">Tarih</th>
                <th className="py-3 px-4 text-right">Tutar</th>
                <th className="py-3 px-4 text-center">Durum</th>
                <th className="py-3 px-4 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredReceipts.map(receipt => {
                const formattedDate = new Date(receipt.created_at).toLocaleString('tr-TR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <tr
                    key={receipt.id}
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-mono font-medium text-[#5AC8FA] text-[11px]">
                      {receipt.id}
                    </td>
                    <td className="py-3.5 px-4 text-white font-medium">
                      {receipt.table_id}
                    </td>
                    <td className="py-3.5 px-4 text-zinc-400">
                      {receipt.cashier_id || 'Otomatik'}
                    </td>
                    <td className="py-3.5 px-4 text-zinc-500 text-[11px]">
                      {formattedDate}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-white">
                      <MoneyDisplay amountInCents={receipt.total_cents} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Ödendi
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedReceipt(receipt)}
                          title="Detay"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handlePrintReceipt(receipt.id)}
                          title="Yazdır"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-[#007AFF] hover:bg-white/10 transition-colors"
                        >
                          <Printer size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredReceipts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500 text-xs">
                    {searchTerm
                      ? `"${searchTerm}" aramasına uygun fiş bulunamadı.`
                      : 'Kayıtlı fiş bulunmuyor.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* iOS Dialog: Fiş Detayı */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl flex flex-col gap-5 dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="text-[#007AFF]" size={18} />
                <h3 className="font-bold text-base dark:text-white text-zinc-900">Fiş Detayı</h3>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/5 hover:dark:bg-white/20 hover:bg-black/10 flex items-center justify-center dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/10 border-black/[0.08] space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Fiş No</span>
                <span className="font-mono text-[#007AFF]">{selectedReceipt.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Masa / Servis</span>
                <span className="dark:text-white text-zinc-900 font-semibold">{selectedReceipt.table_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Kasiyer</span>
                <span className="dark:text-zinc-300 text-zinc-700">{selectedReceipt.cashier_id || 'Otomatik'}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Tarih</span>
                <span className="dark:text-zinc-300 text-zinc-700">
                  {new Date(selectedReceipt.created_at).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="pt-1 flex justify-between items-baseline">
                <span className="dark:text-zinc-400 text-zinc-600 font-medium">Toplam</span>
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  <MoneyDisplay amountInCents={selectedReceipt.total_cents} />
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  handlePrintReceipt(selectedReceipt.id);
                  setSelectedReceipt(null);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white font-semibold rounded-2xl text-xs transition-all shadow-sm cursor-pointer active:scale-95"
              >
                <Printer size={14} />
                <span>Yazdır</span>
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-4 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl text-xs transition-all cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
