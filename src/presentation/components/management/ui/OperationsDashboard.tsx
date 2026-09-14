import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { useFloorStore } from '../../../store/useFloorStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { toast as useToast } from '@core/components/ui/toast';
import { ConfirmationModal } from './ConfirmationModal';
import { Activity, Users, Clock, AlertTriangle, GitMerge, RefreshCw } from 'lucide-react';

type LiveOrderDto = {
  id: string;
  table_name: string;
  status: string;
  total_cents: number;
  created_at: string;
  item_count: number;
};

type OpenShift = {
  id: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  openingBalance: number;
};

type PendingApproval = { id: string; action_type: string; requested_by: string; };

function minutesAgo(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk`;
  return `${Math.floor(mins / 60)}s ${mins % 60}dk`;
}

export function OperationsDashboard() {
  const user = useAuthStore(s => s.user);
  const { tables, fetchFloorPlan } = useFloorStore();

  const [liveOrders, setLiveOrders] = useState<LiveOrderDto[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);

  const occupiedTables = tables.filter(t => t.status === 'OCCUPIED');

  const fetchAll = useCallback(async () => {
    if (!user) return;
    try {
      const [orders, shifts, approvals] = await Promise.all([
        invoke<LiveOrderDto[]>('get_live_orders', { actorRole: user.role }).catch(() => []),
        invoke<OpenShift[]>('get_open_shifts', { actorRole: user.role }).catch(() => []),
        invoke<PendingApproval[]>('get_pending_approvals').catch(() => []),
      ]);
      setLiveOrders(orders);
      setOpenShifts(shifts);
      setPendingApprovals(approvals);
      await fetchFloorPlan();
    } catch (e) {
      console.error('OperationsDashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false);

  const handleMergeClick = () => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
      useToast.add({ title: 'Farklı iki masa seçin', type: 'error' });
      return;
    }
    setIsMergeConfirmOpen(true);
  };

  const confirmMerge = async () => {
    setMerging(true);
    try {
      await invoke('merge_tables', {
        sourceId: mergeSource,
        targetId: mergeTarget,
        actorId: user?.userId || 'MANAGER',
      });
      useToast.add({ title: 'Masalar başarıyla birleştirildi.', type: 'success' });
      setMergeSource('');
      setMergeTarget('');
      setIsMergeConfirmOpen(false);
      await fetchAll();
    } catch (e) {
      useToast.add({ title: `Hata: ${e}`, type: 'error' });
    } finally {
      setMerging(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="space-y-6 p-2">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <Activity size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">Canlı Siparişler</span>
          </div>
          <p className="text-3xl font-bold text-white">{liveOrders.length}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-amber-400 mb-2">
            <Users size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">Dolu Masa</span>
          </div>
          <p className="text-3xl font-bold text-white">{occupiedTables.length}
            <span className="text-sm text-slate-500 font-normal ml-2">/ {tables.length}</span>
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <Clock size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">Açık Vardiya</span>
          </div>
          <p className="text-3xl font-bold text-white">{openShifts.length}</p>
        </div>

        <div className={`border rounded-xl p-4 ${pendingApprovals.length > 0 ? 'bg-orange-950/40 border-orange-700' : 'bg-slate-900 border-slate-800'}`}>
          <div className={`flex items-center gap-2 mb-2 ${pendingApprovals.length > 0 ? 'text-orange-400' : 'text-slate-500'}`}>
            <AlertTriangle size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">Bekleyen Onay</span>
          </div>
          <p className={`text-3xl font-bold ${pendingApprovals.length > 0 ? 'text-orange-300' : 'text-white'}`}>
            {pendingApprovals.length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Live Orders */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="font-semibold text-white text-sm">Canlı Siparişler</h3>
            <button onClick={fetchAll} className="text-slate-500 hover:text-slate-300 transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-slate-400 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Masa</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2 text-right">Kalem</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2 text-right">Süre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {liveOrders.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-500 text-xs">Aktif sipariş yok</td></tr>
                )}
                {liveOrders.map(o => (
                  <tr key={o.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2 text-white font-medium">{o.table_name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                        o.status === 'IN_PROGRESS' ? 'bg-blue-800 text-blue-200' : 'bg-slate-700 text-slate-300'
                      }`}>{o.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{o.item_count}</td>
                    <td className="px-3 py-2 text-right text-white">
                      <MoneyDisplay amountInCents={o.total_cents} />
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 text-xs">{minutesAgo(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: Shifts + Merge */}
        <div className="space-y-4">
          {/* Open Shifts */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="font-semibold text-white text-sm">Açık Vardiyalar</h3>
            </div>
            <div className="p-3 space-y-2">
              {openShifts.length === 0 && (
                <p className="text-slate-500 text-xs text-center py-4">Açık vardiya yok</p>
              )}
              {openShifts.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-slate-800/50 rounded-lg">
                  <div>
                    <p className="text-white text-sm font-medium">{s.cashierName || s.cashierId}</p>
                    <p className="text-slate-500 text-xs">{minutesAgo(s.openedAt)} açıldı</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-300 text-sm">
                      <MoneyDisplay amountInCents={s.openingBalance} />
                    </p>
                    <p className="text-slate-600 text-xs">Açılış</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table Merge */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <GitMerge size={14} className="text-indigo-400" />
              <h3 className="font-semibold text-white text-sm">Masa Birleştir</h3>
            </div>
            <div className="p-4 space-y-3">
              {occupiedTables.length < 2 ? (
                <p className="text-slate-500 text-xs text-center py-2">Birleştirilecek en az 2 dolu masa gerekli</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Kaynak Masa</label>
                      <select
                        value={mergeSource}
                        onChange={e => setMergeSource(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-white text-sm"
                      >
                        <option value="">Seçin...</option>
                        {occupiedTables.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Hedef Masa</label>
                      <select
                        value={mergeTarget}
                        onChange={e => setMergeTarget(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-white text-sm"
                      >
                        <option value="">Seçin...</option>
                        {occupiedTables.filter(t => t.id !== mergeSource).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleMergeClick}
                    disabled={!mergeSource || !mergeTarget || merging}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {merging ? 'Birleştiriliyor...' : 'Masaları Birleştir'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={isMergeConfirmOpen}
        onClose={() => setIsMergeConfirmOpen(false)}
        onConfirm={confirmMerge}
        title="Masaları Birleştir"
        description={`${tables.find(t => t.id === mergeSource)?.name || mergeSource} masasını ${tables.find(t => t.id === mergeTarget)?.name || mergeTarget} masasına birleştirmek üzeresiniz. Tüm açık siparişler aktarılacak ve kaynak masa boş duruma getirilecektir. Devam etmek istiyor musunuz?`}
        confirmText="Birleştir"
        cancelText="Vazgeç"
        confirmVariant="warning"
        isLoading={merging}
      />
    </div>
  );
}
