import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  TrendingUp, 
  Receipt, 
  Clock, 
  RefreshCw, 
  Search, 
  Wallet, 
  CreditCard, 
  Coins, 
  ShoppingBag,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Calendar,
  X,
  Printer,
  User,
  ShieldCheck
} from 'lucide-react';

export interface DailySummary {
  total_revenue_cents: number;
  total_orders: number;
  payment_methods: Record<string, number>;
}

export interface ShiftHistoryItem {
  id: string;
  tenant_id: string;
  cashier_id: string;
  cashierName?: string;
  status: string;
  opened_at: string;
  closed_at?: string | null;
  expected_amount_cents: number;
  actual_amount_cents?: number | null;
  difference_cents?: number | null;
}

export interface ReceiptItem {
  id: string;
  table_id: string;
  total_cents: number;
  created_at: string;
  cashier_id?: string | null;
}

export function ReportsPanel() {
  const user = useAuthStore(s => s.user);
  const [activeTab, setActiveTab] = useState<'daily' | 'shifts' | 'receipts'>('daily');

  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [shifts, setShifts] = useState<ShiftHistoryItem[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedShiftDetail, setSelectedShiftDetail] = useState<ShiftHistoryItem | null>(null);
  const [selectedReceiptDetail, setSelectedReceiptDetail] = useState<ReceiptItem | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchReports = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const [sumData, shiftData, rcpData] = await Promise.all([
        invoke<DailySummary>('get_daily_summary', { actorRole: user?.role || 'MANAGER' }),
        invoke<ShiftHistoryItem[]>('get_shift_history', { cashierId: 'ALL' }),
        invoke<ReceiptItem[]>('get_receipts'),
      ]);
      setSummary(sumData);
      setShifts(shiftData || []);
      setReceipts(rcpData || []);
    } catch (error) {
      console.error('Failed to load reports:', error);
      addToast('Rapor verileri alınamadı.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.role]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Günlük İstatistik Hesaplamaları
  const totalRevenue = summary?.total_revenue_cents || 0;
  const totalOrders = summary?.total_orders || 0;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const paymentMethods = summary?.payment_methods || {};
  const totalMethodsSum = Object.values(paymentMethods).reduce((a, b) => a + b, 0) || totalRevenue || 1;

  // Arama filtreleri
  const filteredReceipts = receipts.filter(r => {
    const term = searchTerm.toLowerCase();
    return r.id.toLowerCase().includes(term) || r.table_id.toLowerCase().includes(term) || (r.cashier_id && r.cashier_id.toLowerCase().includes(term));
  });

  const filteredShifts = shifts.filter(s => {
    const term = searchTerm.toLowerCase();
    return s.id.toLowerCase().includes(term) || s.cashier_id.toLowerCase().includes(term);
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Yükleniyor...</div>;
  }

  const handlePrintReceipt = async (rcp: ReceiptItem) => {
    try {
      await invoke('print_receipt', { order: rcp });
      addToast(`Fiş #${rcp.id} başarıyla yazıcıya gönderildi.`, 'success');
    } catch (err) {
      console.error('Print failed:', err);
      addToast('Yazıcıya gönderilemedi.', 'error');
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6 text-foreground">
      {/* Alt Sekme Seçimi & Yenileme Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 border dark:border-white/10 border-black/[0.08] p-3 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'daily' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5'
            }`}
          >
            <TrendingUp size={16} />
            Günlük Özet Raporu
          </button>
          <button
            onClick={() => setActiveTab('shifts')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'shifts' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5'
            }`}
          >
            <Clock size={16} />
            Vardiya Kapanış Geçmişi ({shifts.length})
          </button>
          <button
            onClick={() => setActiveTab('receipts')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'receipts' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5'
            }`}
          >
            <Receipt size={16} />
            Fiş & Sipariş Geçmişi ({receipts.length})
          </button>
        </div>

        <div className="flex items-center gap-3">
          {(activeTab === 'shifts' || activeTab === 'receipts') && (
            <div className="relative w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder={activeTab === 'shifts' ? "Vardiya no veya kasiyer ara..." : "Fiş no veya masa ara..."}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] text-xs dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-xs dark:text-zinc-400 text-zinc-600 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] px-3.5 py-2 rounded-xl font-medium">
            <Calendar size={14} />
            <span>Bugün: {new Date().toLocaleDateString('tr-TR')}</span>
          </div>

          <button
            onClick={() => fetchReports(true)}
            disabled={isRefreshing}
            className="p-2 rounded-xl backdrop-blur-md dark:bg-white/5 bg-black/5 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/10 border-black/[0.08] transition-all disabled:opacity-50 cursor-pointer"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* SEKME 1: Günlük Özet */}
      {activeTab === 'daily' && (
        <div className="space-y-6 overflow-y-auto">
          {/* Finansal Metrik Kartları */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-5 relative overflow-hidden backdrop-blur-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Toplam Günlük Ciro</span>
                <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl">
                  <TrendingUp size={20} />
                </div>
              </div>
              <div className="mt-2">
                <MoneyDisplay amountInCents={totalRevenue} className="text-3xl font-extrabold text-emerald-500 font-mono tracking-tight" />
              </div>
            </div>

            <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-5 relative overflow-hidden backdrop-blur-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Tamamlanan Sipariş</span>
                <div className="p-2.5 bg-[#007AFF]/10 text-[#007AFF] rounded-xl">
                  <ShoppingBag size={20} />
                </div>
              </div>
              <p className="text-3xl font-extrabold dark:text-white text-zinc-900 mt-2 font-mono tracking-tight">{totalOrders}</p>
            </div>

            <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-5 relative overflow-hidden backdrop-blur-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Ortalama Adisyon</span>
                <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl">
                  <Wallet size={20} />
                </div>
              </div>
              <div className="mt-2">
                <MoneyDisplay amountInCents={avgOrderValue} className="text-3xl font-extrabold text-blue-500 font-mono tracking-tight" />
              </div>
            </div>
          </div>

          {/* Ödeme Yöntemleri Dağılımı */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-5 backdrop-blur-2xl shadow-sm">
              <h4 className="text-base font-bold dark:text-white text-zinc-900 mb-4 flex items-center gap-2">
                <CreditCard size={18} className="text-[#007AFF]" />
                Ödeme Yöntemleri Dağılımı
              </h4>

              {Object.keys(paymentMethods).length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">Bugün henüz ödeme işlemi kaydedilmedi.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(paymentMethods).map(([method, amount]) => {
                    const percentage = Math.round((amount / totalMethodsSum) * 100);
                    const isCash = method.toLowerCase().includes('nakit') || method.toLowerCase().includes('cash');

                    return (
                      <div key={method} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold dark:text-zinc-300 text-zinc-700 flex items-center gap-2 capitalize">
                            {isCash ? <Coins size={15} className="text-amber-500" /> : <CreditCard size={15} className="text-blue-500" />}
                            {method}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs dark:text-zinc-400 text-zinc-500">%{percentage}</span>
                            <MoneyDisplay amountInCents={amount} className="font-bold dark:text-white text-zinc-900 font-mono" />
                          </div>
                        </div>
                        <div className="w-full h-2.5 dark:bg-black/30 bg-black/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isCash ? 'bg-amber-500' : 'bg-[#007AFF]'
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-5 flex flex-col justify-between backdrop-blur-2xl shadow-sm">
              <div>
                <h4 className="text-base font-bold dark:text-white text-zinc-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                  Operasyonel Durum
                </h4>
                <div className="space-y-3 mt-4 text-xs dark:text-zinc-300 text-zinc-700 leading-relaxed">
                  <div className="p-3 dark:bg-black/20 bg-black/[0.02] rounded-xl border dark:border-white/[0.08] border-black/10">
                    <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Mali Mühür & Denetim:</span>
                    <strong className="text-emerald-500">Immutable Hash Ledger Aktif</strong>. Tüm adisyon ve tahsilatlar kriptografik zincirle korunmaktadır.
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t dark:border-white/[0.08] border-black/10 text-xs dark:text-zinc-500 text-zinc-500 flex justify-between items-center">
                <span>Rapor Zamanı:</span>
                <span className="font-mono">{new Date().toLocaleTimeString('tr-TR')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEKME 2: Vardiya Geçmişi */}
      {activeTab === 'shifts' && (
        <div className="flex-1 overflow-auto rounded-3xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.03] bg-white/80 backdrop-blur-xl shadow-sm">
          {filteredShifts.length === 0 ? (
            <div className="p-12 text-center dark:text-zinc-400 text-zinc-500 text-xs">
              Kayıtlı vardiya geçmişi bulunamadı.
            </div>
          ) : (
            <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
              <thead className="sticky top-0 dark:bg-white/[0.04] bg-black/[0.02] backdrop-blur text-[11px] uppercase dark:text-zinc-400 text-zinc-600 border-b dark:border-white/10 border-black/[0.08] font-bold">
                <tr>
                  <th className="px-6 py-4">Vardiya ID</th>
                  <th className="px-6 py-4">Kasiyer</th>
                  <th className="px-6 py-4">Durum</th>
                  <th className="px-6 py-4">Açılış Tarihi</th>
                  <th className="px-6 py-4">Kapanış Tarihi</th>
                  <th className="px-6 py-4 text-right">Başlangıç Kasası</th>
                  <th className="px-6 py-4 text-right">Kapanış Kasası</th>
                  <th className="px-6 py-4 text-right">Kasa Farkı</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/10 divide-black/[0.06]">
                {filteredShifts.map(shift => {
                  const isOpen = shift.status === 'OPEN';
                  const diff = shift.difference_cents || 0;
                  const isExact = diff === 0;
                  const isSurplus = diff > 0;

                  return (
                    <tr 
                      key={shift.id} 
                      onClick={() => setSelectedShiftDetail(shift)}
                      className="hover:dark:bg-white/[0.04] hover:bg-black/[0.02] cursor-pointer transition-colors"
                      title="Detayları görüntülemek için tıklayın"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-[#007AFF] font-semibold">{shift.id}</td>
                      <td className="px-6 py-4 font-semibold dark:text-white text-zinc-900">{shift.cashierName || shift.cashier_id}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isOpen
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'dark:bg-white/5 bg-black/5 dark:text-zinc-400 text-zinc-600 border dark:border-white/10 border-black/[0.08]'
                        }`}>
                          {isOpen ? 'AÇIK' : 'KAPALI'}
                        </span>
                      </td>
                      <td className="px-6 py-4 dark:text-zinc-400 text-zinc-600 text-xs">{new Date(shift.opened_at).toLocaleString('tr-TR')}</td>
                      <td className="px-6 py-4 dark:text-zinc-400 text-zinc-600 text-xs">
                        {shift.closed_at ? new Date(shift.closed_at).toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        <MoneyDisplay amountInCents={shift.expected_amount_cents} className="dark:text-zinc-300 text-zinc-700" />
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        {shift.actual_amount_cents !== null && shift.actual_amount_cents !== undefined ? (
                          <MoneyDisplay amountInCents={shift.actual_amount_cents} className="dark:text-white text-zinc-900" />
                        ) : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-bold">
                        {isOpen ? (
                          <span className="dark:text-zinc-500 text-zinc-500 text-xs">Açık Vardiya</span>
                        ) : isExact ? (
                          <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">Farksız (0 ₺)</span>
                        ) : isSurplus ? (
                          <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5 text-xs">
                            <ArrowUpRight size={14} />
                            +{(diff / 100).toFixed(2)} ₺
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-0.5 text-xs">
                            <ArrowDownRight size={14} />
                            {(diff / 100).toFixed(2)} ₺
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* SEKME 3: Fiş & Sipariş Geçmişi */}
      {activeTab === 'receipts' && (
        <div className="flex-1 overflow-auto rounded-3xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.03] bg-white/80 backdrop-blur-xl shadow-sm">
          {filteredReceipts.length === 0 ? (
            <div className="p-12 text-center dark:text-zinc-400 text-zinc-500">
              Kayıtlı fiş geçmişi bulunamadı.
            </div>
          ) : (
            <table className="w-full text-left text-sm dark:text-zinc-300 text-zinc-700">
              <thead className="sticky top-0 dark:bg-white/[0.04] bg-black/[0.02] backdrop-blur text-xs uppercase dark:text-zinc-400 text-zinc-600 border-b dark:border-white/10 border-black/[0.08]">
                <tr>
                  <th className="px-6 py-4">Fiş / Sipariş No</th>
                  <th className="px-6 py-4">Masa / Referans</th>
                  <th className="px-6 py-4">Tarih & Saat</th>
                  <th className="px-6 py-4">Kasiyer</th>
                  <th className="px-6 py-4 text-right">Tahsil Edilen Tutar</th>
                  <th className="px-6 py-4 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/10 divide-black/[0.06]">
                {filteredReceipts.map(rcp => (
                  <tr 
                    key={rcp.id} 
                    onClick={() => setSelectedReceiptDetail(rcp)}
                    className="hover:dark:bg-white/[0.04] hover:bg-black/[0.02] cursor-pointer transition-colors"
                    title="Fiş detayını ve yazdırma önizlemesini açmak için tıklayın"
                  >
                    <td className="px-6 py-4 font-mono text-xs text-[#007AFF] font-semibold">{rcp.id}</td>
                    <td className="px-6 py-4 font-semibold dark:text-white text-zinc-900">{rcp.table_id}</td>
                    <td className="px-6 py-4 dark:text-zinc-400 text-zinc-600 text-xs">{new Date(rcp.created_at).toLocaleString('tr-TR')}</td>
                    <td className="px-6 py-4 dark:text-zinc-300 text-zinc-700 text-xs">{rcp.cashier_id || 'Kasa'}</td>
                    <td className="px-6 py-4 text-right">
                      <MoneyDisplay amountInCents={rcp.total_cents} className="text-base font-bold text-emerald-600 dark:text-emerald-400" />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrintReceipt(rcp);
                        }}
                        className="p-1.5 rounded-xl dark:bg-white/5 bg-black/5 hover:bg-[#007AFF] dark:text-zinc-300 text-zinc-700 hover:text-white transition-all cursor-pointer"
                        title="Yazdır"
                      >
                        <Printer size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Vardiya Detay Modalı */}
      {selectedShiftDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl border dark:border-white/10 border-black/[0.08] backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-[#007AFF]/15 text-[#007AFF]">
                  <Clock size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold dark:text-white text-zinc-900">Vardiya Kapanış Raporu</h3>
                  <p className="text-xs dark:text-zinc-400 text-zinc-500 font-mono">ID: {selectedShiftDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedShiftDetail(null)}
                className="rounded-xl p-1.5 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/10 hover:bg-black/5 hover:dark:text-white hover:text-zinc-900 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 p-4 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl border dark:border-white/10 border-black/[0.08] text-sm">
                <div>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500 block">Sorumlu Kasiyer:</span>
                  <span className="font-semibold dark:text-white text-zinc-900 flex items-center gap-1.5 mt-0.5">
                    <User size={14} className="text-[#007AFF]" />
                    {selectedShiftDetail.cashierName || selectedShiftDetail.cashier_id}
                  </span>
                </div>
                <div>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500 block">Vardiya Durumu:</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 mt-0.5 rounded-full text-xs font-semibold ${
                    selectedShiftDetail.status === 'OPEN'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'dark:bg-white/5 bg-black/5 dark:text-zinc-400 text-zinc-600 border dark:border-white/10 border-black/[0.08]'
                  }`}>
                    {selectedShiftDetail.status === 'OPEN' ? 'AÇIK' : 'KAPATILDI'}
                  </span>
                </div>
                <div>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500 block">Açılış Zamanı:</span>
                  <span className="dark:text-zinc-300 text-zinc-700 text-xs font-medium">{new Date(selectedShiftDetail.opened_at).toLocaleString('tr-TR')}</span>
                </div>
                <div>
                  <span className="text-xs dark:text-zinc-400 text-zinc-500 block">Kapanış Zamanı:</span>
                  <span className="dark:text-zinc-300 text-zinc-700 text-xs font-medium">
                    {selectedShiftDetail.closed_at ? new Date(selectedShiftDetail.closed_at).toLocaleString('tr-TR') : 'Hala Devam Ediyor'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Finansal Kasa Mutabakatı</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl border dark:border-white/10 border-black/[0.08]">
                    <span className="text-xs dark:text-zinc-400 text-zinc-500 block mb-1">Açılış Kasası</span>
                    <MoneyDisplay amountInCents={selectedShiftDetail.expected_amount_cents} className="text-sm font-bold dark:text-white text-zinc-900" />
                  </div>
                  <div className="p-3 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl border dark:border-white/10 border-black/[0.08]">
                    <span className="text-xs dark:text-zinc-400 text-zinc-500 block mb-1">Kapanış Kasası</span>
                    {selectedShiftDetail.actual_amount_cents !== null && selectedShiftDetail.actual_amount_cents !== undefined ? (
                      <MoneyDisplay amountInCents={selectedShiftDetail.actual_amount_cents} className="text-sm font-bold text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <span className="text-xs dark:text-zinc-500 text-zinc-400">-</span>
                    )}
                  </div>
                  <div className="p-3 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl border dark:border-white/10 border-black/[0.08]">
                    <span className="text-xs dark:text-zinc-400 text-zinc-500 block mb-1">Kasa Farkı</span>
                    {selectedShiftDetail.difference_cents !== null && selectedShiftDetail.difference_cents !== undefined ? (
                      <span className={`text-sm font-bold ${
                        selectedShiftDetail.difference_cents === 0 ? 'text-emerald-600 dark:text-emerald-400' :
                        selectedShiftDetail.difference_cents > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {(selectedShiftDetail.difference_cents / 100).toFixed(2)} ₺
                      </span>
                    ) : (
                      <span className="text-xs dark:text-zinc-500 text-zinc-400">-</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-[#007AFF]/10 border border-[#007AFF]/20 rounded-2xl flex items-start gap-2.5 text-xs text-[#007AFF]">
                <ShieldCheck size={16} className="shrink-0 mt-0.5" />
                <span>Bu vardiya kaydı kriptografik SHA-256 zincirinde doğrulanmıştır. Kasa tutarsızlıkları yöneticinin onayına tabi tutulur.</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedShiftDetail(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl dark:bg-white/10 bg-black/5 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 transition-all cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fiş Detay & ESC/POS Yazdırma Modalı */}
      {selectedReceiptDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl border dark:border-white/10 border-black/[0.08] backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b dark:border-white/10 border-black/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Receipt size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold dark:text-white text-zinc-900">Fiş / Adisyon Detayı</h3>
                  <p className="text-xs dark:text-zinc-400 text-zinc-500 font-mono">No: {selectedReceiptDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReceiptDetail(null)}
                className="rounded-xl p-1.5 dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/10 hover:bg-black/5 hover:dark:text-white hover:text-zinc-900 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl border dark:border-white/10 border-black/[0.08] font-mono text-xs space-y-2 dark:text-zinc-300 text-zinc-700">
              <div className="text-center pb-2 border-b border-dashed dark:border-white/10 border-black/10">
                <p className="font-bold dark:text-white text-zinc-900 uppercase">KASAM360 SATIŞ FİŞİ</p>
                <p className="text-[10px] dark:text-zinc-500 text-zinc-400">Mali Değeri Olmayan Bilgi Fişi</p>
              </div>

              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Masa:</span>
                <span className="font-bold dark:text-white text-zinc-900">{selectedReceiptDetail.table_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Kasiyer:</span>
                <span className="dark:text-zinc-200 text-zinc-800">{selectedReceiptDetail.cashier_id || 'Kasa'}</span>
              </div>
              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Tarih:</span>
                <span className="dark:text-zinc-200 text-zinc-800">{new Date(selectedReceiptDetail.created_at).toLocaleString('tr-TR')}</span>
              </div>

              <div className="pt-2 border-t border-dashed dark:border-white/10 border-black/10 flex justify-between items-center text-sm font-bold">
                <span className="dark:text-white text-zinc-900">TOPLAM:</span>
                <MoneyDisplay amountInCents={selectedReceiptDetail.total_cents} className="text-emerald-600 dark:text-emerald-400 text-base" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => handlePrintReceipt(selectedReceiptDetail)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#007AFF] hover:bg-[#007AFF]/90 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-95"
              >
                <Printer size={15} />
                Termal Yazıcıya Gönder (ESC/POS)
              </button>
              <button
                onClick={() => setSelectedReceiptDetail(null)}
                className="py-2.5 px-4 rounded-xl dark:bg-white/10 bg-black/5 hover:dark:bg-white/15 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 font-semibold text-xs transition-all cursor-pointer"
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
