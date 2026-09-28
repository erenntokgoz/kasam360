import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { useFloorStore } from '../../../store/useFloorStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { toast as useToast } from '@core/components/ui/toast';
import { ConfirmationModal } from './ConfirmationModal';
import { Activity, Clock, GitMerge, RefreshCw } from 'lucide-react';

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

// Apple Borsa / Sağlık tarzı mini trend çizgi grafiği
function MetricMiniLine({ color }: { color: string }) {
  return (
    <div className="h-6 w-16 overflow-hidden">
      <svg className="w-full h-full" viewBox="0 0 50 16">
        <path
          d="M 0,12 Q 15,2 25,10 T 50,4"
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// Geçen süreyi Apple tarzı kısa formatta hesapla
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

  // Canlı operasyonel verileri getir
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
      console.error('Operasyon verileri yükleme hatası:', e);
    } finally {
      setLoading(false);
    }
  }, [user, fetchFloorPlan]);

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

  // Masaları birleştir
  const confirmMerge = async () => {
    setMerging(true);
    try {
      await invoke('merge_tables', {
        sourceId: mergeSource,
        targetId: mergeTarget,
        actorId: user?.userId || 'MANAGER',
      });
      useToast.add({ title: 'Masalar birleştirildi.', type: 'success' });
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
    return <div className="flex items-center justify-center h-48 text-xs text-zinc-500">Yükleniyor...</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 select-none">
      {/* Apple Sağlık / Borsa Tarzı 4'lü Metrik Kartları */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Canlı Siparişler */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all backdrop-blur-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Canlı Siparişler
            </span>
            <MetricMiniLine color="#38bdf8" />
          </div>
          <p className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-3 font-mono">{liveOrders.length}</p>
        </div>

        {/* Dolu Masalar */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all backdrop-blur-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Dolu Masa
            </span>
            <MetricMiniLine color="#f59e0b" />
          </div>
          <div className="flex items-baseline gap-1.5 mt-3">
            <span className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 font-mono">{occupiedTables.length}</span>
            <span className="text-xs dark:text-zinc-500 text-zinc-500 font-normal">/ {tables.length}</span>
          </div>
        </div>

        {/* Açık Vardiya */}
        <div className="dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/10 rounded-2xl p-5 transition-all backdrop-blur-2xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Açık Vardiya
            </span>
            <MetricMiniLine color="#34d399" />
          </div>
          <p className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-3 font-mono">{openShifts.length}</p>
        </div>

        {/* Bekleyen Onay */}
        <div className={`border rounded-2xl p-5 transition-all backdrop-blur-2xl shadow-sm ${
          pendingApprovals.length > 0 
            ? 'bg-amber-500/10 border-amber-500/30' 
            : 'dark:bg-white/[0.04] bg-white/75 hover:dark:bg-white/[0.07] hover:bg-white dark:border-white/10 border-black/10'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Bekleyen Onay
            </span>
            <MetricMiniLine color={pendingApprovals.length > 0 ? '#f59e0b' : '#71717a'} />
          </div>
          <p className={`text-3xl font-bold tracking-tight mt-3 font-mono ${
            pendingApprovals.length > 0 ? 'text-amber-500' : 'dark:text-white text-zinc-900'
          }`}>
            {pendingApprovals.length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Canlı Siparişler Tablosu (1px white/5 ayırıcılar & ferah satırlar) */}
        <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl overflow-hidden flex flex-col backdrop-blur-2xl shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/10 border-black/10">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[#007AFF]" />
              <h3 className="text-xs font-bold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">Canlı Siparişler</h3>
            </div>
            <button onClick={fetchAll} className="dark:text-zinc-500 text-zinc-400 hover:dark:text-white hover:text-black transition-colors cursor-pointer">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="dark:text-zinc-400 text-zinc-500 text-[11px] uppercase tracking-wider border-b dark:border-white/10 border-black/10 dark:bg-black/20 bg-zinc-100/60 font-semibold">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Masa</th>
                  <th className="px-4 py-3 text-left font-semibold">Durum</th>
                  <th className="px-4 py-3 text-right font-semibold">Kalem</th>
                  <th className="px-4 py-3 text-right font-semibold">Tutar</th>
                  <th className="px-5 py-3 text-right font-semibold">Süre</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/5 divide-black/5">
                {liveOrders.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-zinc-500 text-xs">Aktif sipariş yok</td></tr>
                )}
                {liveOrders.map(o => (
                  <tr key={o.id} className="hover:dark:bg-white/[0.02] hover:bg-black/[0.02] transition-colors">
                    <td className="px-5 py-3.5 dark:text-white text-zinc-900 font-semibold">{o.table_name}</td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        o.status === 'IN_PROGRESS' 
                          ? 'bg-sky-500/10 text-sky-500 border border-sky-500/20' 
                          : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
                      }`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right dark:text-zinc-400 text-zinc-600 font-mono">{o.item_count}</td>
                    <td className="px-4 py-3.5 text-right font-bold dark:text-white text-zinc-900 font-mono">
                      <MoneyDisplay amountInCents={o.total_cents} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-zinc-500 text-[11px] font-mono">{minutesAgo(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sağ Kolon: Vardiyalar + Masa Birleştirme */}
        <div className="space-y-5">
          {/* Açık Vardiyalar */}
          <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl overflow-hidden backdrop-blur-2xl shadow-sm">
            <div className="px-5 py-4 border-b dark:border-white/10 border-black/10 flex items-center gap-2">
              <Clock size={16} className="text-emerald-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">Açık Vardiyalar</h3>
            </div>
            <div className="p-4 space-y-2.5">
              {openShifts.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-6">Açık vardiya bulunmuyor</p>
              )}
              {openShifts.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3.5 dark:bg-black/20 bg-black/[0.02] border dark:border-white/5 border-black/5 rounded-xl">
                  <div>
                    <p className="dark:text-white text-zinc-900 text-xs font-semibold">{s.cashierName || s.cashierId}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">{minutesAgo(s.openedAt)} önce açıldı</p>
                  </div>
                  <div className="text-right">
                    <p className="dark:text-white text-zinc-900 text-xs font-bold font-mono">
                      <MoneyDisplay amountInCents={s.openingBalance} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Masa Birleştirme */}
          <div className="dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl overflow-hidden backdrop-blur-2xl shadow-sm">
            <div className="px-5 py-4 border-b dark:border-white/10 border-black/10 flex items-center gap-2">
              <GitMerge size={16} className="text-[#007AFF]" />
              <h3 className="text-xs font-bold uppercase tracking-wider dark:text-zinc-400 text-zinc-600">Masa Birleştir</h3>
            </div>
            <div className="p-5 space-y-4">
              {occupiedTables.length < 2 ? (
                <p className="text-zinc-500 text-xs text-center py-3">En az 2 dolu masa gerekli</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-zinc-400 uppercase tracking-wider mb-1.5 block">Kaynak Masa</label>
                      <select
                        value={mergeSource}
                        onChange={e => setMergeSource(e.target.value)}
                        className="w-full bg-[#2c2c2e] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-white/30"
                      >
                        <option value="">Seçin...</option>
                        {occupiedTables.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-400 uppercase tracking-wider mb-1.5 block">Hedef Masa</label>
                      <select
                        value={mergeTarget}
                        onChange={e => setMergeTarget(e.target.value)}
                        className="w-full bg-[#2c2c2e] border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-white/30"
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
                    className="w-full py-2.5 bg-white hover:bg-zinc-200 disabled:opacity-40 text-black rounded-xl text-xs font-semibold transition-colors"
                  >
                    {merging ? 'Birleştiriliyor...' : 'Masaları Birleştir'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* iOS Dialog: Masa Birleştirme Onayı */}
      <ConfirmationModal
        isOpen={isMergeConfirmOpen}
        onClose={() => setIsMergeConfirmOpen(false)}
        onConfirm={confirmMerge}
        title="Masaları Birleştir"
        description={`${tables.find(t => t.id === mergeSource)?.name || mergeSource} masası ${tables.find(t => t.id === mergeTarget)?.name || mergeTarget} masasına aktarılacak.`}
        confirmText="Birleştir"
        cancelText="Vazgeç"
        confirmVariant="warning"
        isLoading={merging}
      />
    </div>
  );
}
