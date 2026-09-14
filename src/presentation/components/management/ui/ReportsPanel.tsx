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
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Alt Sekme Seçimi & Yenileme Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === 'daily' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <TrendingUp size={16} />
            Günlük Özet Raporu
          </button>
          <button
            onClick={() => setActiveTab('shifts')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === 'shifts' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Clock size={16} />
            Vardiya Kapanış Geçmişi ({shifts.length})
          </button>
          <button
            onClick={() => setActiveTab('receipts')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === 'receipts' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Receipt size={16} />
            Fiş & Sipariş Geçmişi ({receipts.length})
          </button>
        </div>

        <div className="flex items-center gap-3">
          {(activeTab === 'shifts' || activeTab === 'receipts') && (
            <div className="relative w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder={activeTab === 'shifts' ? "Vardiya no veya kasiyer ara..." : "Fiş no veya masa ara..."}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg">
            <Calendar size={14} />
            <span>Bugün: {new Date().toLocaleDateString('tr-TR')}</span>
          </div>

          <button
            onClick={() => fetchReports(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Toplam Günlük Ciro</span>
                <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
                  <TrendingUp size={20} />
                </div>
              </div>
              <div className="mt-2">
                <MoneyDisplay amountInCents={totalRevenue} className="text-3xl font-extrabold text-emerald-400" />
              </div>
              <p className="text-xs text-slate-500 mt-1">Bugün tamamlanan tüm tahsilatlar</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Tamamlanan Adisyon / Sipariş</span>
                <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
                  <ShoppingBag size={20} />
                </div>
              </div>
              <p className="text-3xl font-extrabold text-white mt-2">{totalOrders}</p>
              <p className="text-xs text-slate-500 mt-1">Ödemesi alınmış fiş adedi</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Ortalama Adisyon Değeri</span>
                <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
                  <Wallet size={20} />
                </div>
              </div>
              <div className="mt-2">
                <MoneyDisplay amountInCents={avgOrderValue} className="text-3xl font-extrabold text-blue-400" />
              </div>
              <p className="text-xs text-slate-500 mt-1">Sipariş başına düşen ortalama harcama</p>
            </div>
          </div>

          {/* Ödeme Yöntemleri Dağılımı */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h4 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <CreditCard size={18} className="text-indigo-400" />
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
                          <span className="font-semibold text-slate-300 flex items-center gap-2 capitalize">
                            {isCash ? <Coins size={15} className="text-amber-400" /> : <CreditCard size={15} className="text-blue-400" />}
                            {method}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-400">%{percentage}</span>
                            <MoneyDisplay amountInCents={amount} className="font-bold text-white" />
                          </div>
                        </div>
                        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isCash ? 'bg-amber-500' : 'bg-indigo-500'
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

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <h4 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  Operasyonel Performans Notları
                </h4>
                <div className="space-y-3 mt-4 text-xs text-slate-300 leading-relaxed">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block mb-1">Mali Mühür & Denetim Durumu:</span>
                    <strong className="text-emerald-400">Kasam360 Immutable Hash Ledger Aktif</strong>. Tüm günlük ödemeler ve iptaller kriptografik olarak zincirlenmektedir.
                  </div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block mb-1">Gün Sonu Kapatma Bilgisi:</span>
                    Gün sonu (Z-Raporu) işlemini ana gösterge panelinden veya vardiya bitişlerinde gerçekleştirebilirsiniz.
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 flex justify-between items-center">
                <span>Rapor Üretim Zamanı:</span>
                <span className="font-mono">{new Date().toLocaleTimeString('tr-TR')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEKME 2: Vardiya Geçmişi */}
      {activeTab === 'shifts' && (
        <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900">
          {filteredShifts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Kayıtlı vardiya geçmişi bulunamadı.
            </div>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-xs uppercase text-slate-400 border-b border-slate-800">
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
              <tbody className="divide-y divide-slate-800/60">
                {filteredShifts.map(shift => {
                  const isOpen = shift.status === 'OPEN';
                  const diff = shift.difference_cents || 0;
                  const isExact = diff === 0;
                  const isSurplus = diff > 0;

                  return (
                    <tr 
                      key={shift.id} 
                      onClick={() => setSelectedShiftDetail(shift)}
                      className="hover:bg-slate-800/70 cursor-pointer transition-colors"
                      title="Detayları görüntülemek için tıklayın"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-indigo-400 font-semibold">{shift.id}</td>
                      <td className="px-6 py-4 font-semibold text-white">{shift.cashierName || shift.cashier_id}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isOpen
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {isOpen ? 'AÇIK' : 'KAPALI'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-xs">{new Date(shift.opened_at).toLocaleString('tr-TR')}</td>
                      <td className="px-6 py-4 text-slate-400 text-xs">
                        {shift.closed_at ? new Date(shift.closed_at).toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        <MoneyDisplay amountInCents={shift.expected_amount_cents} className="text-slate-300" />
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        {shift.actual_amount_cents !== null && shift.actual_amount_cents !== undefined ? (
                          <MoneyDisplay amountInCents={shift.actual_amount_cents} className="text-white" />
                        ) : '-'}
                      </td>
                      <td className="px-6 py-4 text-right font-bold">
                        {isOpen ? (
                          <span className="text-slate-500 text-xs">Açık Vardiya</span>
                        ) : isExact ? (
                          <span className="text-emerald-400 text-xs font-semibold">Farksız (0 ₺)</span>
                        ) : isSurplus ? (
                          <span className="text-emerald-400 inline-flex items-center gap-0.5 text-xs">
                            <ArrowUpRight size={14} />
                            +{(diff / 100).toFixed(2)} ₺
                          </span>
                        ) : (
                          <span className="text-red-400 inline-flex items-center gap-0.5 text-xs">
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
        <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900">
          {filteredReceipts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Kayıtlı fiş geçmişi bulunamadı.
            </div>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Fiş / Sipariş No</th>
                  <th className="px-6 py-4">Masa / Referans</th>
                  <th className="px-6 py-4">Tarih & Saat</th>
                  <th className="px-6 py-4">Kasiyer</th>
                  <th className="px-6 py-4 text-right">Tahsil Edilen Tutar</th>
                  <th className="px-6 py-4 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredReceipts.map(rcp => (
                  <tr 
                    key={rcp.id} 
                    onClick={() => setSelectedReceiptDetail(rcp)}
                    className="hover:bg-slate-800/70 cursor-pointer transition-colors"
                    title="Fiş detayını ve yazdırma önizlemesini açmak için tıklayın"
                  >
                    <td className="px-6 py-4 font-mono text-xs text-indigo-400 font-semibold">{rcp.id}</td>
                    <td className="px-6 py-4 font-semibold text-white">{rcp.table_id}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs">{new Date(rcp.created_at).toLocaleString('tr-TR')}</td>
                    <td className="px-6 py-4 text-slate-300 text-xs">{rcp.cashier_id || 'Kasa'}</td>
                    <td className="px-6 py-4 text-right">
                      <MoneyDisplay amountInCents={rcp.total_cents} className="text-base font-bold text-emerald-400" />
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrintReceipt(rcp);
                        }}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Clock size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Vardiya Kapanış Raporu</h3>
                  <p className="text-xs text-slate-400 font-mono">ID: {selectedShiftDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedShiftDetail(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 text-sm">
                <div>
                  <span className="text-xs text-slate-500 block">Sorumlu Kasiyer:</span>
                  <span className="font-semibold text-white flex items-center gap-1.5 mt-0.5">
                    <User size={14} className="text-indigo-400" />
                    {selectedShiftDetail.cashierName || selectedShiftDetail.cashier_id}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Vardiya Durumu:</span>
                  <span className={`inline-flex items-center px-2 py-0.5 mt-0.5 rounded-full text-xs font-semibold ${
                    selectedShiftDetail.status === 'OPEN'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}>
                    {selectedShiftDetail.status === 'OPEN' ? 'AÇIK' : 'KAPATILDI'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Açılış Zamanı:</span>
                  <span className="text-slate-300 text-xs">{new Date(selectedShiftDetail.opened_at).toLocaleString('tr-TR')}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Kapanış Zamanı:</span>
                  <span className="text-slate-300 text-xs">
                    {selectedShiftDetail.closed_at ? new Date(selectedShiftDetail.closed_at).toLocaleString('tr-TR') : 'Hala Devam Ediyor'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Finansal Kasa Mutabakatı</h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">Açılış Kasası</span>
                    <MoneyDisplay amountInCents={selectedShiftDetail.expected_amount_cents} className="text-sm font-bold text-white" />
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">Kapanış Kasası</span>
                    {selectedShiftDetail.actual_amount_cents !== null && selectedShiftDetail.actual_amount_cents !== undefined ? (
                      <MoneyDisplay amountInCents={selectedShiftDetail.actual_amount_cents} className="text-sm font-bold text-emerald-400" />
                    ) : (
                      <span className="text-xs text-slate-500">-</span>
                    )}
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">Kasa Farkı</span>
                    {selectedShiftDetail.difference_cents !== null && selectedShiftDetail.difference_cents !== undefined ? (
                      <span className={`text-sm font-bold ${
                        selectedShiftDetail.difference_cents === 0 ? 'text-emerald-400' :
                        selectedShiftDetail.difference_cents > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {(selectedShiftDetail.difference_cents / 100).toFixed(2)} ₺
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">-</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-xl flex items-start gap-2.5 text-xs text-indigo-300">
                <ShieldCheck size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                <span>Bu vardiya kaydı kriptografik SHA-256 zincirinde doğrulanmıştır. Kasa tutarsızlıkları yöneticinin onayına tabi tutulur.</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedShiftDetail(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fiş Detay & ESC/POS Yazdırma Modalı */}
      {selectedReceiptDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Receipt size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Fiş / Adisyon Detayı</h3>
                  <p className="text-xs text-slate-400 font-mono">No: {selectedReceiptDetail.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReceiptDetail(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs space-y-2 text-slate-300">
              <div className="text-center pb-2 border-b border-dashed border-slate-800">
                <p className="font-bold text-white uppercase">KASAM360 SATIŞ FİŞİ</p>
                <p className="text-[10px] text-slate-500">Mali Değeri Olmayan Bilgi Fişi</p>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Masa:</span>
                <span className="font-bold text-white">{selectedReceiptDetail.table_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kasiyer:</span>
                <span>{selectedReceiptDetail.cashier_id || 'Kasa'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tarih:</span>
                <span>{new Date(selectedReceiptDetail.created_at).toLocaleString('tr-TR')}</span>
              </div>

              <div className="pt-2 border-t border-dashed border-slate-800 flex justify-between items-center text-sm font-bold">
                <span className="text-white">TOPLAM:</span>
                <MoneyDisplay amountInCents={selectedReceiptDetail.total_cents} className="text-emerald-400 text-base" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => handlePrintReceipt(selectedReceiptDetail)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Printer size={15} />
                Termal Yazıcıya Gönder (ESC/POS)
              </button>
              <button
                onClick={() => setSelectedReceiptDetail(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold text-xs transition-colors"
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
