import { useState, useEffect, useMemo, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import {
  ShieldCheck,
  Search,
  RefreshCw,
  Clock,
  User,
  Hash,
  Activity,
  Layers,
  CheckCircle2,
  X,
  Copy,
  Receipt,
  AlertTriangle,
  Package,
  Wallet,
} from 'lucide-react';
import { toast as useToast } from '@core/components/ui/toast';

export interface AuditLogDto {
  id: string;
  sequence: number;
  timestamp: string;
  actor_id: string;
  action: string;
  resource_id: string;
  current_hash: string;
}

// Apple tarzı mini kıvrımlı grafik
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

// Eylem türüne göre Türkçe etiket, ikon ve rozet stili belirle
function getActionMeta(action: string) {
  const act = action.toUpperCase();
  if (act.includes('VOID') || act.includes('CANCEL')) {
    return {
      label: 'Sipariş İptali (Void)',
      category: 'VOID',
      badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      icon: <AlertTriangle size={13} />,
    };
  }
  if (act.includes('WASTE') || act.includes('FIRE')) {
    return {
      label: 'Fire / Zayi Düşümü',
      category: 'STOCK',
      badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      icon: <Package size={13} />,
    };
  }
  if (act.includes('PURCHASE') || act.includes('RECEIPT') || act.includes('STOCK')) {
    return {
      label: 'Hammadde Girişi (İkmal)',
      category: 'STOCK',
      badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      icon: <Package size={13} />,
    };
  }
  if (act.includes('CASH') || act.includes('SHIFT')) {
    return {
      label: 'Kasa & Vardiya Hareketi',
      category: 'CASH',
      badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      icon: <Wallet size={13} />,
    };
  }
  if (act.includes('ORDER') || act.includes('PAYMENT')) {
    return {
      label: 'Sipariş & Ödeme İşlemi',
      category: 'ORDERS',
      badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      icon: <Receipt size={13} />,
    };
  }
  return {
    label: action,
    category: 'OTHER',
    badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    icon: <Activity size={13} />,
  };
}

// Patron ekranı detaylı filtrelenebilir denetim defteri (Immutable Audit Ledger)
export function OwnerAuditLogsTab() {
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtreler & Arama
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'ORDERS' | 'VOID' | 'STOCK' | 'CASH'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Detay Modalı
  const [selectedLog, setSelectedLog] = useState<AuditLogDto | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  // Denetim kayıtlarını IPC üzerinden çek
  const fetchLogs = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const data = await invoke<AuditLogDto[]>('get_audit_logs');
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Denetim kayıtları çekilemedi:', err);
      setError('Sistem denetim logları yüklenirken hata oluştu.');
      setLogs([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Filtreleme mantığı
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const meta = getActionMeta(log.action);
      const matchesFilter = selectedFilter === 'ALL' || meta.category === selectedFilter;
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        searchTerm.trim() === '' ||
        log.actor_id.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        log.resource_id.toLowerCase().includes(term) ||
        meta.label.toLowerCase().includes(term) ||
        log.current_hash.toLowerCase().includes(term);
      return matchesFilter && matchesSearch;
    });
  }, [logs, selectedFilter, searchTerm]);

  // Hash panoya kopyalama
  const handleCopyHash = (hash: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(hash);
      addToast('SHA-256 hash panoya kopyalandı.', 'info');
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 select-none text-zinc-900 dark:text-zinc-100">
      {/* Üst Başlık & Yenileme Aksiyonu — Bağımsız Yüzen Cam Ada */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={22} className="text-[#007AFF]" />
            <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">
              Sistem Logları (Detaylı Audit Ledger)
            </h2>
          </div>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            Sipariş açma, iptal/void, fire düşümü, hammadde girişi ve kasa hareketlerinin SHA-256 hash zincirli kayıtları.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] text-emerald-600 dark:text-emerald-400 text-xs font-semibold shadow-inner">
            <CheckCircle2 size={13} />
            <span>Kriptografik İzi Aktif</span>
          </div>

          <button
            onClick={() => fetchLogs(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 rounded-2xl text-xs font-medium dark:text-white text-zinc-900 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-zinc-400' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* Hata Bildirimi */}
      {error && (
        <div className="p-3.5 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Apple Borsa / Sağlık Tarzı 3'lü Renksiz Cam İstatistik Kartları — Bağımsız Yüzen Adalar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Toplam İşlem Sayısı */}
        <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Toplam Kayıt
            </span>
            <MetricMiniLine color="#007AFF" />
          </div>
          <div className="text-3xl font-bold tracking-tight dark:text-white text-zinc-900 mt-2 font-mono">
            {logs.length}
          </div>
        </div>

        {/* Bütünlük & Güvenlik Doğrulaması */}
        <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Hash Güvencesi
            </span>
            <MetricMiniLine color="#10b981" />
          </div>
          <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-3 flex items-center gap-1.5">
            <CheckCircle2 size={16} />
            <span>SHA-256 Değiştirilemez</span>
          </div>
        </div>

        {/* Son Kayıt Zamanı */}
        <div className="dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Son Güncelleme
            </span>
            <MetricMiniLine color="#f59e0b" />
          </div>
          <div className="text-xs font-mono dark:text-zinc-300 text-zinc-700 mt-3 flex items-center gap-1.5">
            <Clock size={14} className="text-amber-500" />
            <span>{logs[0] ? new Date(logs[0].timestamp).toLocaleTimeString('tr-TR') : '—'}</span>
          </div>
        </div>
      </div>

      {/* Arama ve Filtreleme Kapsülleri */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Arama Çubuğu */}
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="İşlem, kullanıcı, masa veya hash ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs dark:text-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-[#007AFF] transition-all backdrop-blur-md"
          />
        </div>

        {/* Operasyon Türü Kapsülleri — Bağımsız Yüzen Cam Kapsül */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-md border dark:border-white/10 border-black/[0.08] shadow-sm overflow-x-auto pb-1 sm:pb-1.5 no-scrollbar">
          {[
            { id: 'ALL', label: 'Tüm Operasyonlar' },
            { id: 'ORDERS', label: 'Siparişler' },
            { id: 'VOID', label: 'İptal / Void' },
            { id: 'STOCK', label: 'Stok & Fire' },
            { id: 'CASH', label: 'Kasa & Vardiya' },
          ].map((tab) => {
            const isSelected = selectedFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSelectedFilter(tab.id as typeof selectedFilter)}
                className={`px-3.5 py-1.5 rounded-2xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm border dark:border-white/10 border-black/[0.08]'
                    : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 dark:bg-white/[0.03] bg-black/[0.03]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Renksiz Şeffaf Cam Denetim Tablosu */}
      <div className="rounded-3xl dark:bg-white/[0.03] bg-white/70 backdrop-blur-xl dark:border-white/10 border-black/[0.08] border overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex h-56 items-center justify-center text-xs dark:text-zinc-400 text-zinc-500">
            Kayıtlar yükleniyor...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center text-zinc-400">
            <Layers size={36} className="mb-2 opacity-30" />
            <p className="text-sm font-medium">Bu filtreye uygun denetim kaydı bulunamadı.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b dark:border-white/10 border-black/[0.08] dark:text-zinc-400 text-zinc-600 uppercase tracking-wider text-[11px] font-semibold dark:bg-white/[0.01] bg-black/[0.02]">
                  <th className="py-3.5 px-5">
                    <div className="flex items-center gap-1.5">
                      <Activity size={13} />
                      <span>Sıra</span>
                    </div>
                  </th>
                  <th className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <Clock size={13} />
                      <span>Tarih & Saat</span>
                    </div>
                  </th>
                  <th className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <User size={13} />
                      <span>Personel</span>
                    </div>
                  </th>
                  <th className="py-3.5 px-4">Operasyon Türü</th>
                  <th className="py-3.5 px-4">Kaynak / Detay</th>
                  <th className="py-3.5 px-5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Hash size={13} />
                      <span>Kripto Hash (SHA-256)</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                {filteredLogs.map((log) => {
                  const meta = getActionMeta(log.action);
                  return (
                    <tr
                      key={log.id || `${log.sequence}-${log.timestamp}`}
                      onClick={() => setSelectedLog(log)}
                      className="hover:dark:bg-white/[0.04] hover:bg-white/90 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5 font-mono font-bold text-[#007AFF]">
                        #{log.sequence}
                      </td>
                      <td className="py-3.5 px-4 dark:text-zinc-300 text-zinc-700 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('tr-TR')}
                      </td>
                      <td className="py-3.5 px-4 font-semibold dark:text-white text-zinc-900">
                        {log.actor_id}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${meta.badge}`}
                        >
                          {meta.icon}
                          <span>{meta.label}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono dark:text-zinc-300 text-zinc-700 max-w-xs truncate" title={log.resource_id}>
                        {log.resource_id}
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-[10px] dark:text-zinc-500 text-zinc-400" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleCopyHash(log.current_hash)}
                          className="hover:text-[#007AFF] transition-colors inline-flex items-center gap-1 cursor-pointer"
                          title="Hash Kopyala"
                        >
                          <span>{log.current_hash.slice(0, 14)}...</span>
                          <Copy size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* iOS Dialog: Log Detayı */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={20} className="text-[#007AFF]" />
                <h3 className="font-semibold text-base dark:text-white text-zinc-900">
                  Denetim Kaydı #{selectedLog.sequence}
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-black transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="dark:bg-white/[0.03] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/5 border-black/[0.05] space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">Operasyon</span>
                <span className="font-semibold dark:text-white text-zinc-900">
                  {getActionMeta(selectedLog.action).label}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">İşlem Kodu</span>
                <span className="font-mono text-[#007AFF]">{selectedLog.action}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">Personel / Aktör</span>
                <span className="font-medium dark:text-white text-zinc-900">{selectedLog.actor_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">Tarih</span>
                <span className="dark:text-zinc-300 text-zinc-700">
                  {new Date(selectedLog.timestamp).toLocaleString('tr-TR')}
                </span>
              </div>
              <div className="py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Kaynak / Hedef</span>
                <span className="font-mono dark:text-zinc-200 text-zinc-800 break-all">
                  {selectedLog.resource_id}
                </span>
              </div>
              <div className="py-1">
                <span className="dark:text-zinc-400 text-zinc-500 block mb-1">SHA-256 Hash İmzası</span>
                <div className="p-2.5 rounded-xl dark:bg-black/40 bg-black/5 font-mono text-[10px] break-all dark:text-zinc-300 text-zinc-700 border dark:border-white/5 border-black/5 flex items-center justify-between gap-2">
                  <span>{selectedLog.current_hash}</span>
                  <button
                    onClick={() => handleCopyHash(selectedLog.current_hash)}
                    className="p-1 hover:text-[#007AFF] transition-colors shrink-0"
                    title="Kopyala"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedLog(null)}
              className="w-full py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
