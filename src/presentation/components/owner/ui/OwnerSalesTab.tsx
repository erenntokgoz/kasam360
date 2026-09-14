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
  Calendar,
  Eye,
  X,
  CheckCircle2,
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

export function OwnerSalesTab() {
  const user = useAuthStore(state => state.user);
  const [dailySummary, setDailySummary] = useState<DailySummaryDto | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsDashboardDataDto | null>(null);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters & Modal
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptDto | null>(null);
  const [printStatus, setPrintStatus] = useState<string | null>(null);

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
      console.error('Failed to load sales data:', err);
      setErrorMessage(typeof err === 'string' ? err : 'Satış verileri yüklenirken bir sorun oluştu.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSalesData();
  }, [user]);

  const handlePrintReceipt = async (receiptId: string) => {
    try {
      setPrintStatus('Yazdırılıyor...');
      await invoke('print_receipt', { orderId: receiptId, order_id: receiptId });
      setPrintStatus('Yazdırma komutu başarıyla gönderildi.');
      setTimeout(() => setPrintStatus(null), 3000);
    } catch (err) {
      console.error('Print receipt error:', err);
      setPrintStatus('Yazdırma hatası: ' + String(err));
      setTimeout(() => setPrintStatus(null), 4000);
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
      return <Banknote size={18} className="text-emerald-400" />;
    }
    return <CreditCard size={18} className="text-blue-400" />;
  };

  const getMethodLabel = (method: string) => {
    const m = method.toLowerCase();
    if (m.includes('nakit') || m.includes('cash')) return 'Nakit';
    if (m.includes('kredi') || m.includes('card') || m.includes('kart')) return 'Kredi Kartı';
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-slate-400 py-16">
        <RefreshCw size={36} className="animate-spin text-indigo-500" />
        <p className="font-medium">Satış ve ciro verileri yükleniyor...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header & Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="text-indigo-400" />
            Satış & Ciro Raporu
          </h2>
          <p className="text-sm text-slate-400 mt-1 flex items-center gap-2">
            <Calendar size={14} className="text-slate-500" />
            Bugünün canlı satış performansı ve fiş dökümü
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchSalesData(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg text-slate-300 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-red-950/40 border border-red-800 text-red-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Bugünkü Toplam Ciro</span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">
            <MoneyDisplay amountInCents={totalSalesCents} />
          </div>
          <div className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle2 size={13} />
            <span>Kasa aktif ve güncel</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Toplam Sipariş</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShoppingCart size={18} />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{totalOrdersCount}</div>
          <div className="text-xs text-slate-500">
            Tamamlanan ve kapatılan siparişler
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Ortalama Sepet Tutarı</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Layers size={18} />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">
            <MoneyDisplay amountInCents={averageBasketCents} />
          </div>
          <div className="text-xs text-slate-500">
            Sipariş başına ortalama harcama
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3 shadow-lg">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Geçmiş Fiş Sayısı</span>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <Receipt size={18} />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{receipts.length}</div>
          <div className="text-xs text-slate-500">
            Kayıtlı ve arşivlenmiş fişler
          </div>
        </div>
      </div>

      {/* Distribution Section: Payment Methods & Popular Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Methods */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <CreditCard size={20} className="text-indigo-400" />
              <h3 className="font-semibold text-white text-base">Ödeme Yöntemleri Dağılımı</h3>
            </div>
            <span className="text-xs text-slate-500">Gün Sonu FIFO Mutabakatı</span>
          </div>

          {Object.keys(paymentMethods).length > 0 ? (
            <div className="flex flex-col gap-4">
              {Object.entries(paymentMethods).map(([method, amountCents]) => {
                const percentage =
                  totalPaymentMethodsCents > 0
                    ? Math.round((amountCents / totalPaymentMethodsCents) * 100)
                    : 0;

                return (
                  <div key={method} className="bg-slate-950/80 rounded-lg p-3.5 border border-slate-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        {getMethodIcon(method)}
                        <span className="font-medium text-slate-200 text-sm">
                          {getMethodLabel(method)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 font-mono">%{percentage}</span>
                        <span className="font-bold text-white text-base">
                          <MoneyDisplay amountInCents={amountCents} />
                        </span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, percentage))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-slate-500 text-sm text-center py-8">
              Bugün için henüz ödeme yöntemi kaydı bulunmuyor.
            </div>
          )}
        </div>

        {/* Popular Categories */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <PieChart size={20} className="text-emerald-400" />
              <h3 className="font-semibold text-white text-base">Kategori Bazlı Satış Hacmi</h3>
            </div>
            <span className="text-xs text-slate-500">Sipariş Sayıları</span>
          </div>

          {analytics?.popular_categories && Object.keys(analytics.popular_categories).length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(analytics.popular_categories).map(([catName, count]) => (
                <div
                  key={catName}
                  className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between"
                >
                  <span className="text-xs text-slate-400 font-medium truncate" title={catName}>
                    {catName}
                  </span>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-2xl font-bold text-white">{count}</span>
                    <span className="text-xs text-slate-500">sipariş</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm text-center py-8">
              Henüz kategori bazlı satış kaydı bulunmuyor.
            </div>
          )}
        </div>
      </div>

      {/* Receipts Table Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <Receipt size={22} className="text-indigo-400" />
            <div>
              <h3 className="font-semibold text-white text-lg">Geçmiş Fiş Listesi</h3>
              <p className="text-xs text-slate-400">Tamamlanan tüm sipariş ve fiş kayıtları</p>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Fiş No, Masa veya Kasiyer ara..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {printStatus && (
          <div className="p-3 rounded-lg bg-indigo-950/60 border border-indigo-700 text-indigo-200 text-sm flex items-center gap-2">
            <Printer size={16} />
            <span>{printStatus}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-medium">
                <th className="py-3 px-4">Fiş / Sipariş No</th>
                <th className="py-3 px-4">Masa / Servis</th>
                <th className="py-3 px-4">Kasiyer</th>
                <th className="py-3 px-4">Tarih & Saat</th>
                <th className="py-3 px-4 text-right">Tutar</th>
                <th className="py-3 px-4 text-center">Durum</th>
                <th className="py-3 px-4 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
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
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-indigo-300">
                      {receipt.id}
                    </td>
                    <td className="py-3 px-4 text-white font-medium">
                      {receipt.table_id}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {receipt.cashier_id || 'Otomatik'}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-xs">
                      {formattedDate}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-white text-base">
                      <MoneyDisplay amountInCents={receipt.total_cents} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                        ÖDENDİ
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedReceipt(receipt)}
                          title="Fiş Detayı Görüntüle"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => handlePrintReceipt(receipt.id)}
                          title="Fişi Yazdır"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-colors"
                        >
                          <Printer size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredReceipts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {searchTerm
                      ? `"${searchTerm}" arama kriterine uygun fiş bulunamadı.`
                      : 'Henüz kayıtlı fiş bulunmuyor.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receipt Detail Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Receipt className="text-indigo-400" size={22} />
                <h3 className="font-bold text-lg text-white">Fiş Detayı</h3>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Fiş No:</span>
                <span className="font-mono text-indigo-300 font-semibold">{selectedReceipt.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Masa / Servis:</span>
                <span className="text-white font-medium">{selectedReceipt.table_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Kasiyer:</span>
                <span className="text-white">{selectedReceipt.cashier_id || 'Otomatik / Kasa 1'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tarih & Saat:</span>
                <span className="text-white">
                  {new Date(selectedReceipt.created_at).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="border-t border-slate-800 pt-3 flex justify-between items-baseline">
                <span className="text-slate-300 font-semibold">Toplam Tutar:</span>
                <span className="text-xl font-bold text-white">
                  <MoneyDisplay amountInCents={selectedReceipt.total_cents} />
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  handlePrintReceipt(selectedReceipt.id);
                  setSelectedReceipt(null);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
              >
                <Printer size={16} />
                <span>Fişi Yazdır</span>
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
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
