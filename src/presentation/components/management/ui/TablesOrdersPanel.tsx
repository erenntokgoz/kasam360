import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  Utensils, 
  Clock, 
  RefreshCw, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Bookmark, 
  Receipt,
  Layers,
  GitMerge
} from 'lucide-react';

export interface FloorTable {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | string;
  openedAt?: string;
  waiterId?: string;
  currentTotal: number;
}

export interface LiveOrder {
  id: string;
  table_name: string;
  status: string;
  total_cents: number;
  created_at: string;
  item_count: number;
}

function timeSince(dateStr?: string): string {
  if (!dateStr) return '-';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  return `${hours} sa ${mins % 60} dk`;
}

export function TablesOrdersPanel() {
  const user = useAuthStore(s => s.user);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED' | 'RESERVED'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'tables' | 'orders'>('tables');
  const [updatingTableId, setUpdatingTableId] = useState<string | null>(null);

  // Detay & Birleştirme Modalları State
  const [selectedTableDetail, setSelectedTableDetail] = useState<FloorTable | null>(null);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<LiveOrder | null>(null);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchData = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const [tableData, orderData] = await Promise.all([
        invoke<FloorTable[]>('get_floor_plan'),
        invoke<LiveOrder[]>('get_live_orders', { actorRole: user?.role || 'MANAGER' }),
      ]);
      setTables(tableData || []);
      setLiveOrders(orderData || []);
    } catch (error) {
      console.error('Failed to load tables & orders:', error);
      addToast('Masa ve sipariş verileri alınamadı.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.role]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(false), 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleUpdateStatus = async (tableId: string, newStatus: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED') => {
    setUpdatingTableId(tableId);
    try {
      await invoke('update_table_status', { tableId, status: newStatus });
      addToast(`Masa durumu güncellendi: ${newStatus}`, 'success');
      // İyimser yerel güncelleme
      setTables(prev => prev.map(t => t.id === tableId ? { ...t, status: newStatus } : t));
      await fetchData(false);
    } catch (error) {
      console.error('Failed to update table status:', error);
      addToast('Masa durumu güncellenemedi.', 'error');
    } finally {
      setUpdatingTableId(null);
    }
  };

  const occupiedCount = tables.filter(t => t.status === 'OCCUPIED').length;
  const availableCount = tables.filter(t => t.status === 'AVAILABLE').length;
  const reservedCount = tables.filter(t => t.status === 'RESERVED').length;
  const totalOccupiedSales = tables
    .filter(t => t.status === 'OCCUPIED')
    .reduce((sum, t) => sum + (t.currentTotal || 0), 0);

  const filteredTables = tables.filter(table => {
    const matchesStatus = statusFilter === 'ALL' || table.status === statusFilter;
    const matchesSearch = table.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const filteredOrders = liveOrders.filter(order => {
    const term = searchTerm.toLowerCase();
    return order.table_name.toLowerCase().includes(term) || order.id.toLowerCase().includes(term);
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Üst İstatistik Kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase">
            <Layers size={14} />
            <span>Toplam Masa</span>
          </div>
          <p className="text-2xl font-bold text-white mt-1">{tables.length}</p>
        </div>

        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase">
            <Utensils size={14} />
            <span>Dolu Masalar</span>
          </div>
          <p className="text-2xl font-bold text-amber-300 mt-1">{occupiedCount}</p>
        </div>

        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase">
            <CheckCircle2 size={14} />
            <span>Boş Masalar</span>
          </div>
          <p className="text-2xl font-bold text-emerald-300 mt-1">{availableCount}</p>
        </div>

        <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold uppercase">
            <Bookmark size={14} />
            <span>Rezerve</span>
          </div>
          <p className="text-2xl font-bold text-blue-300 mt-1">{reservedCount}</p>
        </div>

        <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase">
            <Receipt size={14} />
            <span>Aktif Sipariş</span>
          </div>
          <p className="text-2xl font-bold text-indigo-300 mt-1">{liveOrders.length}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase">
            <Clock size={14} />
            <span>Açık Adisyon Toplamı</span>
          </div>
          <div className="mt-1">
            <MoneyDisplay amountInCents={totalOccupiedSales} className="text-xl font-bold text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Kontrol & Filtre Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('tables')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSubTab === 'tables' 
                ? 'bg-indigo-600 text-white shadow' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Masa Düzeni ({tables.length})
          </button>
          <button
            onClick={() => setActiveSubTab('orders')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSubTab === 'orders' 
                ? 'bg-indigo-600 text-white shadow' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Canlı Siparişler ({liveOrders.length})
          </button>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder={activeSubTab === 'tables' ? "Masa ara..." : "Sipariş veya masa ara..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {activeSubTab === 'tables' && (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${statusFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Tümü
              </button>
              <button
                onClick={() => setStatusFilter('OCCUPIED')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${statusFilter === 'OCCUPIED' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Dolu
              </button>
              <button
                onClick={() => setStatusFilter('AVAILABLE')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${statusFilter === 'AVAILABLE' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Boş
              </button>
              <button
                onClick={() => setStatusFilter('RESERVED')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${statusFilter === 'RESERVED' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Rezerve
              </button>
            </div>
          )}

          {activeSubTab === 'tables' && (
            <button
              onClick={() => {
                setMergeSourceId('');
                setMergeTargetId('');
                setIsMergeModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 text-xs font-semibold transition-colors"
              title="Masaları Birleştir"
            >
              <GitMerge size={15} />
              <span>Masaları Birleştir</span>
            </button>
          )}

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* İçerik Görünümü */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'tables' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredTables.map(table => {
              const isOccupied = table.status === 'OCCUPIED';
              const isReserved = table.status === 'RESERVED';
              const isAvailable = table.status === 'AVAILABLE';

              return (
                <div
                  key={table.id}
                  onClick={() => setSelectedTableDetail(table)}
                  className={`relative rounded-xl border p-4 transition-all flex flex-col justify-between cursor-pointer ${
                    isOccupied
                      ? 'bg-amber-950/20 border-amber-700/50 hover:border-amber-500 hover:shadow-lg hover:shadow-amber-950/20'
                      : isReserved
                      ? 'bg-blue-950/20 border-blue-700/50 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-950/20'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:shadow-lg'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-lg font-bold text-white">{table.name}</h4>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                          isOccupied
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : isReserved
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {isOccupied ? 'DOLU' : isReserved ? 'REZERVE' : 'BOŞ'}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-slate-400 mb-4">
                      {isOccupied && (
                        <>
                          <div className="flex justify-between items-center">
                            <span>Açılış:</span>
                            <span className="font-medium text-slate-300">{timeSince(table.openedAt)}</span>
                          </div>
                          {table.waiterId && (
                            <div className="flex justify-between items-center">
                              <span>Garson:</span>
                              <span className="font-medium text-slate-300">{table.waiterId}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                            <span className="text-slate-300 font-medium">Masa Tutarı:</span>
                            <MoneyDisplay amountInCents={table.currentTotal || 0} className="text-base font-bold text-emerald-400" />
                          </div>
                        </>
                      )}
                      {isAvailable && (
                        <p className="text-slate-500 py-2">Masa şu anda müsait ve müşteri almaya hazır.</p>
                      )}
                      {isReserved && (
                        <p className="text-blue-300 py-2">Masa rezervasyon için ayrılmış durumda.</p>
                      )}
                    </div>
                  </div>

                  {/* Masa Durum Değiştirme Butonları */}
                  <div 
                    className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="text-[11px] text-slate-500 font-medium">Durum:</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUpdateStatus(table.id, 'AVAILABLE')}
                        disabled={updatingTableId === table.id || isAvailable}
                        className={`text-[11px] px-2 py-1 rounded transition-colors ${
                          isAvailable
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-default'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title="Boş Olarak İşaretle"
                      >
                        Boş
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(table.id, 'OCCUPIED')}
                        disabled={updatingTableId === table.id || isOccupied}
                        className={`text-[11px] px-2 py-1 rounded transition-colors ${
                          isOccupied
                            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 cursor-default'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title="Dolu Olarak İşaretle"
                      >
                        Dolu
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(table.id, 'RESERVED')}
                        disabled={updatingTableId === table.id || isReserved}
                        className={`text-[11px] px-2 py-1 rounded transition-colors ${
                          isReserved
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 cursor-default'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title="Rezerve Olarak İşaretle"
                      >
                        Rezerve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Canlı Siparişler Tablosu */
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {filteredOrders.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <AlertCircle className="mx-auto h-8 w-8 mb-2 opacity-50" />
                Aktif canlı sipariş bulunamadı.
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/80 text-xs uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Sipariş ID</th>
                    <th className="px-6 py-3">Masa / Referans</th>
                    <th className="px-6 py-3">Ürün Adedi</th>
                    <th className="px-6 py-3">Sipariş Süresi</th>
                    <th className="px-6 py-3">Durum</th>
                    <th className="px-6 py-3 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredOrders.map(order => (
                    <tr 
                      key={order.id} 
                      onClick={() => setSelectedOrderDetail(order)}
                      className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-xs text-indigo-400">{order.id}</td>
                      <td className="px-6 py-4 font-semibold text-white">{order.table_name}</td>
                      <td className="px-6 py-4">{order.item_count} adet ürün</td>
                      <td className="px-6 py-4 text-slate-400">{timeSince(order.created_at)}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <MoneyDisplay amountInCents={order.total_cents} className="text-base font-bold text-emerald-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: Masa Detayı ve Hızlı Yönetim */}
      {selectedTableDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedTableDetail.name} Detayı</h3>
                <p className="text-xs text-slate-400 font-mono">ID: {selectedTableDetail.id}</p>
              </div>
              <button
                onClick={() => setSelectedTableDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Güncel Durum:</span>
                <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase ${
                  selectedTableDetail.status === 'OCCUPIED' ? 'bg-amber-500/20 text-amber-300' :
                  selectedTableDetail.status === 'RESERVED' ? 'bg-blue-500/20 text-blue-300' :
                  'bg-emerald-500/20 text-emerald-300'
                }`}>
                  {selectedTableDetail.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Açılış Zamanı:</span>
                <span className="text-slate-200">{timeSince(selectedTableDetail.openedAt)}</span>
              </div>
              {selectedTableDetail.waiterId && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">İlgili Garson:</span>
                  <span className="text-slate-200">{selectedTableDetail.waiterId}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                <span className="text-slate-400 font-medium">Toplam Açık Adisyon:</span>
                <MoneyDisplay amountInCents={selectedTableDetail.currentTotal || 0} className="text-base font-bold text-emerald-400" />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-400">Masa Durumunu Değiştir:</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    handleUpdateStatus(selectedTableDetail.id, 'AVAILABLE');
                    setSelectedTableDetail(prev => prev ? { ...prev, status: 'AVAILABLE' } : null);
                  }}
                  className="py-2 px-3 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-700/50 text-emerald-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Boş Yap
                </button>
                <button
                  onClick={() => {
                    handleUpdateStatus(selectedTableDetail.id, 'OCCUPIED');
                    setSelectedTableDetail(prev => prev ? { ...prev, status: 'OCCUPIED' } : null);
                  }}
                  className="py-2 px-3 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-700/50 text-amber-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Dolu Yap
                </button>
                <button
                  onClick={() => {
                    handleUpdateStatus(selectedTableDetail.id, 'RESERVED');
                    setSelectedTableDetail(prev => prev ? { ...prev, status: 'RESERVED' } : null);
                  }}
                  className="py-2 px-3 bg-blue-950/40 hover:bg-blue-900/60 border border-blue-700/50 text-blue-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Rezerve Yap
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedTableDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Canlı Sipariş Detayı */}
      {selectedOrderDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Sipariş #{selectedOrderDetail.id}</h3>
                <p className="text-xs text-slate-400">{selectedOrderDetail.table_name}</p>
              </div>
              <button
                onClick={() => setSelectedOrderDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Masa:</span>
                <span className="font-bold text-white">{selectedOrderDetail.table_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Sipariş Durumu:</span>
                <span className="px-2.5 py-0.5 rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {selectedOrderDetail.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Ürün Adedi:</span>
                <span className="text-slate-200 font-semibold">{selectedOrderDetail.item_count} adet</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Sipariş Zamanı:</span>
                <span className="text-slate-200">{new Date(selectedOrderDetail.created_at).toLocaleTimeString('tr-TR')} ({timeSince(selectedOrderDetail.created_at)})</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                <span className="text-slate-400 font-medium">Toplam Adisyon Tutarı:</span>
                <MoneyDisplay amountInCents={selectedOrderDetail.total_cents} className="text-base font-bold text-emerald-400" />
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedOrderDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Masaları Birleştir Modalı */}
      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitMerge className="text-indigo-400" size={20} />
                <h3 className="text-lg font-bold text-white">Masaları Birleştir</h3>
              </div>
              <button
                onClick={() => setIsMergeModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Kaynak masadaki tüm açık sipariş ve tutarları hedef masaya aktarır. Kaynak masa daha sonra boş olarak işaretlenir.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Kaynak Masa (Aktarılacak)</label>
                <select
                  value={mergeSourceId}
                  onChange={e => setMergeSourceId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Kaynak Masa Seçin...</option>
                  {tables.filter(t => t.status === 'OCCUPIED').map(t => (
                    <option key={t.id} value={t.id}>{t.name} (Tutar: {(t.currentTotal / 100).toFixed(2)} ₺)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Hedef Masa (Birleştirilecek)</label>
                <select
                  value={mergeTargetId}
                  onChange={e => setMergeTargetId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Hedef Masa Seçin...</option>
                  {tables.filter(t => t.id !== mergeSourceId).map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.status === 'OCCUPIED' ? `Dolu - ${(t.currentTotal / 100).toFixed(2)} ₺` : 'Boş'})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                disabled={isMerging}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || isMerging}
                onClick={async () => {
                  if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) return;
                  setIsMerging(true);
                  try {
                    await invoke('merge_tables', {
                      sourceId: mergeSourceId,
                      targetId: mergeTargetId,
                      actorId: user?.userId || 'MANAGER',
                    });
                    addToast('Masalar başarıyla birleştirildi.', 'success');
                    setIsMergeModalOpen(false);
                    setMergeSourceId('');
                    setMergeTargetId('');
                    await fetchData(false);
                  } catch (err) {
                    console.error('Failed to merge tables:', err);
                    addToast('Masa birleştirme hatası.', 'error');
                  } finally {
                    setIsMerging(false);
                  }
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors shadow-lg shadow-indigo-600/30"
              >
                {isMerging ? 'Birleştiriliyor...' : 'Masaları Birleştir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
