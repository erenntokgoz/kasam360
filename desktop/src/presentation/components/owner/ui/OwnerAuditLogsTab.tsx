import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  FileDown,
  FileJson,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  ALL_OPERATIONS,
  AuditLogDto,
  buildAuditCsv,
  buildAuditJson,
  filterAuditLogs,
  OperationSelection,
  OPERATION_FILTERS,
  auditActionLabel,
  auditCategoryLabel,
} from '../../../../core/audit/auditCatalog';
import {
  AuditLogDetailModal,
  categoryBadgeStyle,
} from './OwnerAuditLogDetailModal';
import { toast as useToast } from '@core/components/ui/toast';

/** Dışa aktarım dosya adı: gün + saat damgası ile çakışmaz. */
function exportFileName(extension: 'csv' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `denetim-defteri-${stamp}.${extension}`;
}

/** Tarayıcıda dosya indirir. Hash içermeyen metin yazılır. */
function downloadTextFile(fileName: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Patron denetim defteri ekranı.
 *
 * Kayıtlar backend'den mühürlü (hash'siz) olarak gelir. Beş operasyon filtresi
 * ve kategori rozeti saf katalog modülünden beslenir; ekran yalnızca sunar.
 */
export function OwnerAuditLogsTab() {
  const user = useAuthStore((state) => state.user);
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';
  const callerRole = user?.role || 'OWNER';
  const addToast = (msg: string, type: 'success' | 'error' | 'info') =>
    useToast.add({ title: msg, type });

  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<OperationSelection>(ALL_OPERATIONS);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLogDto | null>(null);

  const fetchLogs = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const data = await invoke<AuditLogDto[]>('get_audit_logs', {
          callerRole,
          caller_role: callerRole,
          tenantId,
          tenant_id: tenantId,
          filter: { limit: 200, offset: 0 },
        });
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Denetim kayıtları çekilemedi:', err);
        setError('Denetim kayıtları yüklenemedi. Yetkiniz yeterli olmayabilir.');
        setLogs([]);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [callerRole, tenantId],
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = useMemo(
    () => filterAuditLogs(logs, selectedFilter, searchTerm),
    [logs, selectedFilter, searchTerm],
  );

  const sealedCount = useMemo(
    () => filteredLogs.filter((log) => log.sealed).length,
    [filteredLogs],
  );

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) {
      addToast('Dışa aktarılacak kayıt yok.', 'info');
      return;
    }
    downloadTextFile(exportFileName('csv'), 'text/csv', buildAuditCsv(filteredLogs));
    addToast(`${filteredLogs.length} kayıt CSV olarak indirildi.`, 'success');
  };

  const handleExportJson = () => {
    if (filteredLogs.length === 0) {
      addToast('Dışa aktarılacak kayıt yok.', 'info');
      return;
    }
    downloadTextFile(
      exportFileName('json'),
      'application/json',
      buildAuditJson(filteredLogs),
    );
    addToast(`${filteredLogs.length} kayıt JSON olarak indirildi.`, 'success');
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={22} className="text-[#0A84FF]" />
            <h2 className="text-xl font-semibold tracking-tight dark:text-white text-zinc-900">
              Sistem Denetim Defteri
            </h2>
          </div>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            İşletmenizin değiştirilemez işlem kayıtları. Bütünlük doğrulaması
            sunucuda yapılır; burada yalnızca mühür durumu görünür.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] text-xs font-medium dark:text-white text-zinc-900 transition-all cursor-pointer shadow-sm"
          >
            <FileDown size={13} />
            <span>CSV</span>
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] text-xs font-medium dark:text-white text-zinc-900 transition-all cursor-pointer shadow-sm"
          >
            <FileJson size={13} />
            <span>JSON</span>
          </button>
          <button
            onClick={() => fetchLogs(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 rounded-2xl text-xs font-medium dark:text-white text-zinc-900 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-3xl bg-[#FF453A]/10 border border-[#FF453A]/20 text-xs text-[#FF453A] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Uyarıyı kapat">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Toplam Kayıt" value={String(logs.length)} />
        <StatCard
          label="Görünen Kayıt"
          value={`${filteredLogs.length} / ${logs.length}`}
        />
        <StatCard label="Mühürlü Kayıt" value={String(sealedCount)} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="İşlem, personel, kategori veya kaynak ara..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            aria-label="Denetim kayıtlarında ara"
            className="w-full pl-9 pr-4 py-2.5 dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs dark:text-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-[#0A84FF] transition-all backdrop-blur-md"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1.5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-md border dark:border-white/10 border-black/[0.08] shadow-sm overflow-x-auto">
          <FilterChip
            id={ALL_OPERATIONS}
            label="Tüm Kayıtlar"
            selected={selectedFilter === ALL_OPERATIONS}
            onSelect={setSelectedFilter}
          />
          {OPERATION_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              id={filter.id}
              label={filter.label}
              selected={selectedFilter === filter.id}
              onSelect={setSelectedFilter}
            />
          ))}
        </div>
      </div>

      <div className="rounded-3xl dark:bg-white/[0.03] bg-white/70 backdrop-blur-xl dark:border-white/10 border-black/[0.08] border overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex h-56 items-center justify-center text-xs dark:text-zinc-400 text-zinc-500">
            Kayıtlar yükleniyor...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 text-center text-zinc-400">
            <Layers size={32} className="mb-2 opacity-30" />
            <p className="text-sm font-medium">Bu seçime uygun denetim kaydı yok.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b dark:border-white/10 border-black/[0.08] dark:text-zinc-400 text-zinc-600 uppercase tracking-wider text-[11px] font-semibold">
                  <th className="py-3.5 px-5">
                    <span className="flex items-center gap-1.5">
                      <Activity size={13} />
                      <span>Sıra</span>
                    </span>
                  </th>
                  <th className="py-3.5 px-4">
                    <span className="flex items-center gap-1.5">
                      <Clock size={13} />
                      <span>Tarih &amp; Saat</span>
                    </span>
                  </th>
                  <th className="py-3.5 px-4">
                    <span className="flex items-center gap-1.5">
                      <User size={13} />
                      <span>Personel</span>
                    </span>
                  </th>
                  <th className="py-3.5 px-4">İşlem</th>
                  <th className="py-3.5 px-4">Kategori</th>
                  <th className="py-3.5 px-4">Kaynak</th>
                  <th className="py-3.5 px-5 text-right">Bütünlük</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id || `${log.sequence}-${log.timestamp}`}
                    onClick={() => setSelectedLog(log)}
                    className="hover:dark:bg-white/[0.04] hover:bg-white/90 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-5 font-mono font-semibold text-[#0A84FF] tabular-nums">
                      #{log.sequence}
                    </td>
                    <td className="py-3.5 px-4 dark:text-zinc-300 text-zinc-700 whitespace-nowrap tabular-nums">
                      {new Date(log.timestamp).toLocaleString('tr-TR')}
                    </td>
                    <td className="py-3.5 px-4 font-medium dark:text-white text-zinc-900">
                      {log.actor_id}
                    </td>
                    <td className="py-3.5 px-4 dark:text-zinc-200 text-zinc-800">
                      {auditActionLabel(log.action)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${categoryBadgeStyle(
                          log.category,
                        )}`}
                      >
                        {auditCategoryLabel(log.category)}
                      </span>
                    </td>
                    <td
                      className="py-3.5 px-4 font-mono dark:text-zinc-300 text-zinc-700 max-w-xs truncate"
                      title={log.resource_id}
                    >
                      {log.resource_id}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2.5 py-1 text-[11px] font-semibold text-[#30D158]">
                        <ShieldCheck size={12} />
                        <span>Mühürlü</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AuditLogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 backdrop-blur-xl shadow-lg">
      <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
        {label}
      </span>
      <div className="text-2xl font-semibold tracking-tight dark:text-white text-zinc-900 mt-2 tabular-nums">
        {value}
      </div>
    </div>
  );
}

interface FilterChipProps {
  id: OperationSelection;
  label: string;
  selected: boolean;
  onSelect: (id: OperationSelection) => void;
}

function FilterChip({ id, label, selected, onSelect }: FilterChipProps) {
  return (
    <button
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`px-3.5 py-1.5 rounded-2xl text-xs font-medium shrink-0 transition-all cursor-pointer ${
        selected
          ? 'dark:bg-white/15 bg-white dark:text-white text-[#0A84FF] shadow-sm border dark:border-white/10 border-black/[0.08]'
          : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 dark:bg-white/[0.03] bg-black/[0.03]'
      }`}
    >
      {label}
    </button>
  );
}
