import { useState, useEffect, useMemo, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { 
  Shield, 
  RefreshCw, 
  Search, 
  AlertOctagon, 
  CheckCircle2, 
  Lock, 
  Terminal, 
  Monitor, 
  Wrench, 
  Download, 
  Radio, 
  Zap, 
  Eye, 
  Layers, 
  AlertTriangle, 
  Cpu,
  Server
} from 'lucide-react';
import { 
  AuditLogDto, 
  RemoteSessionModal, 
  ITActionModal, 
  LogDetailModal 
} from './ITOpsModals';

interface TenantDto {
  id: string;
  name: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Süper Admin',
  OWNER: 'İşletme Sahibi',
  MANAGER: 'Müdür',
  CASHIER: 'Kasiyer',
  WAITER: 'Garson',
  KITCHEN: 'Mutfak',
  SYSTEM: 'Sistem / Arka Plan',
};

const SEVERITY_COLORS: Record<string, { badge: string; border: string; text: string }> = {
  CRITICAL: {
    badge: 'bg-red-950/80 text-red-300 border-red-700/80',
    border: 'border-red-600/40',
    text: 'text-red-400',
  },
  HIGH: {
    badge: 'bg-orange-950/80 text-orange-300 border-orange-700/80',
    border: 'border-orange-600/40',
    text: 'text-orange-400',
  },
  MEDIUM: {
    badge: 'bg-amber-950/80 text-amber-300 border-amber-700/80',
    border: 'border-amber-600/40',
    text: 'text-amber-400',
  },
  LOW: {
    badge: 'bg-blue-950/80 text-blue-300 border-blue-700/80',
    border: 'border-blue-600/40',
    text: 'text-blue-400',
  },
  INFO: {
    badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80',
    border: 'border-emerald-600/40',
    text: 'text-emerald-400',
  },
};

export function GlobalAuditPanel() {
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtreleme Durumları
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'>('ALL');
  const [categoryTab, setCategoryTab] = useState<'ALL' | 'CRITICAL_ONLY' | 'HARDWARE' | 'SYNC' | 'SECURITY' | 'PAYMENT'>('ALL');
  const [selectedTenantFilter, setSelectedTenantFilter] = useState<string>('ALL');

  // Kriptografik Bütünlük Doğrulama Durumu
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ isValid: boolean; timestamp: string; count: number } | null>(null);

  // Modal Durumları
  const [remoteSessionTarget, setRemoteSessionTarget] = useState<{ id: string; name: string } | null>(null);
  const [itActionTarget, setItActionTarget] = useState<{ id: string; name: string } | null>(null);
  const [detailModalLog, setDetailModalLog] = useState<AuditLogDto | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsData, tenantsData] = await Promise.all([
        tauriInvoke<AuditLogDto[]>('get_platform_audit_logs', { callerRole: 'MASTER' }),
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
      ]);
      setLogs(logsData);
      setTenants(tenantsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    try {
      const res = await tauriInvoke<{ isValid: boolean; verifiedCount: number; timestamp: string }>('verify_audit_ledger_integrity', {});
      setVerifyResult({
        isValid: res.isValid,
        count: res.verifiedCount,
        timestamp: new Date(res.timestamp).toLocaleTimeString('tr-TR'),
      });
    } catch (e: unknown) {
      setError(`Bütünlük doğrulanırken hata: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setVerifying(false);
    }
  };

  // CSV / JSON Dışa Aktarma (Export)
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `kasam360_audit_ledger_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportCsv = () => {
    const headers = ['Sira', 'Zaman', 'Islem', 'Onem', 'HataKodu', 'Aktor', 'Rol', 'Isletme', 'IP', 'Hash'];
    const rows = logs.map(l => [
      l.sequence,
      `"${l.timestamp}"`,
      `"${l.action.replace(/"/g, '""')}"`,
      l.severity || 'INFO',
      l.errorCode || '',
      `"${l.actorId}"`,
      l.actorRole,
      `"${l.tenantName || l.tenantId || ''}"`,
      l.ipAddress || '',
      `"${l.hash}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", encodeURI(csvContent));
    downloadAnchor.setAttribute("download", `kasam360_audit_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // İstatistik Hesaplamaları
  const stats = useMemo(() => {
    const critical = logs.filter(l => l.severity === 'CRITICAL').length;
    const high = logs.filter(l => l.severity === 'HIGH').length;
    const hardware = logs.filter(l => l.category === 'HARDWARE' || (l.errorCode && l.errorCode.includes('DEVICE'))).length;
    const sync = logs.filter(l => l.category === 'SYNC' || (l.errorCode && l.errorCode.includes('SYNC'))).length;
    return { critical, high, hardware, sync };
  }, [logs]);

  // Filtreleme Mantığı
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Metin araması
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        log.action.toLowerCase().includes(query) ||
        log.actorId.toLowerCase().includes(query) ||
        log.resourceId.toLowerCase().includes(query) ||
        log.hash.toLowerCase().includes(query) ||
        (log.errorCode && log.errorCode.toLowerCase().includes(query)) ||
        (log.tenantName && log.tenantName.toLowerCase().includes(query)) ||
        (log.ipAddress && log.ipAddress.toLowerCase().includes(query));

      // Önem derecesi filtresi
      const matchesSeverity =
        selectedSeverity === 'ALL' || log.severity === selectedSeverity;

      // Kategori sekmesi
      let matchesCategory = true;
      if (categoryTab === 'CRITICAL_ONLY') {
        matchesCategory = log.severity === 'CRITICAL' || log.severity === 'HIGH';
      } else if (categoryTab === 'HARDWARE') {
        matchesCategory = log.category === 'HARDWARE' || (!!log.errorCode && log.errorCode.includes('DEVICE'));
      } else if (categoryTab === 'SYNC') {
        matchesCategory = log.category === 'SYNC' || (!!log.errorCode && log.errorCode.includes('SYNC'));
      } else if (categoryTab === 'SECURITY') {
        matchesCategory = log.category === 'SECURITY' || (!!log.errorCode && log.errorCode.includes('AUTH'));
      } else if (categoryTab === 'PAYMENT') {
        matchesCategory = log.category === 'PAYMENT' || (!!log.errorCode && log.errorCode.includes('PAYMENT'));
      }

      // İşletme filtresi
      const matchesTenant =
        selectedTenantFilter === 'ALL' || log.tenantId === selectedTenantFilter;

      return matchesSearch && matchesSeverity && matchesCategory && matchesTenant;
    });
  }, [logs, searchQuery, selectedSeverity, categoryTab, selectedTenantFilter]);

  return (
    <div className="space-y-5 w-full text-left">
      {/* ÜST BAR & OPERASYON PANELİ BAŞLIĞI */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-indigo-400 shadow-inner">
              <Terminal size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
                Platform Güvenlik &amp; IT Teşhis Operasyon Merkezi
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/60">
                  IT Ops Console
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Kriptografik SHA-256 denetim defteri, müşteri ekranına canlı uzaktan erişim ve IT acil müdahale araçları.
              </p>
            </div>
          </div>
        </div>

        {/* Hızlı Aksiyon Araçları */}
        <div className="flex flex-wrap items-center gap-2">
          {/* SHA-256 Doğrulama Butonu */}
          <button
            onClick={handleVerifyIntegrity}
            disabled={verifying}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/70 text-emerald-300 rounded-lg text-xs font-semibold transition-all shadow-sm disabled:opacity-50"
            title="Tüm defter bloklarının SHA-256 hash zincirini anlık teyit et"
          >
            <Lock size={14} className={verifying ? 'animate-spin' : 'text-emerald-400'} />
            <span>{verifying ? 'Doğrulanıyor...' : 'Bütünlüğü Doğrula'}</span>
          </button>

          {/* Dışa Aktar Butonları */}
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5">
            <button
              onClick={handleExportJson}
              className="px-2.5 py-1.5 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors flex items-center gap-1"
              title="JSON Olarak Dışa Aktar"
            >
              <Download size={13} />
              JSON
            </button>
            <span className="text-slate-600 text-xs">|</span>
            <button
              onClick={handleExportCsv}
              className="px-2.5 py-1.5 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors flex items-center gap-1"
              title="CSV Olarak Dışa Aktar"
            >
              CSV
            </button>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* BÜTÜNLÜK DOĞRULAMA BİLGİLENDİRME ROZETİ */}
      {verifyResult && (
        <div className="bg-emerald-950/40 border border-emerald-700/60 rounded-xl p-3 flex items-center justify-between text-xs text-emerald-300 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>
              <strong>Kriptografik Bütünlük Teyit Edildi:</strong> {verifyResult.count} adet denetim bloğunun SHA-256 zinciri bozulmamıştır (Doğrulama: {verifyResult.timestamp}).
            </span>
          </div>
          <button 
            onClick={() => setVerifyResult(null)}
            className="text-slate-400 hover:text-white text-[11px]"
          >
            Kapat
          </button>
        </div>
      )}

      {/* IT KPI METRİKLERİ KARTLARI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
          <p className="text-slate-400 text-xs font-medium">Toplam Denetim Bloğu</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-2xl font-bold text-white font-mono">{logs.length}</p>
            <Layers size={18} className="text-indigo-400" />
          </div>
        </div>

        <div className="bg-slate-800/80 border border-red-900/60 rounded-xl p-3.5 shadow-sm bg-gradient-to-br from-red-950/20 to-transparent">
          <p className="text-red-300/80 text-xs font-medium">Kritik Hatalar (CRITICAL)</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-2xl font-bold text-red-400 font-mono">{stats.critical}</p>
            <AlertOctagon size={18} className="text-red-400" />
          </div>
        </div>

        <div className="bg-slate-800/80 border border-orange-900/60 rounded-xl p-3.5 shadow-sm bg-gradient-to-br from-orange-950/20 to-transparent">
          <p className="text-orange-300/80 text-xs font-medium">Yüksek Risk (HIGH)</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-2xl font-bold text-orange-400 font-mono">{stats.high}</p>
            <AlertTriangle size={18} className="text-orange-400" />
          </div>
        </div>

        <div className="bg-slate-800/80 border border-cyan-900/60 rounded-xl p-3.5 shadow-sm">
          <p className="text-cyan-300/80 text-xs font-medium">Donanım &amp; Terminal Olayı</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-2xl font-bold text-cyan-400 font-mono">{stats.hardware}</p>
            <Cpu size={18} className="text-cyan-400" />
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
          <p className="text-slate-400 text-xs font-medium">Senkronizasyon Kuyruğu</p>
          <div className="flex items-center justify-between mt-1">
            <p className="text-2xl font-bold text-blue-400 font-mono">{stats.sync}</p>
            <Radio size={18} className="text-blue-400" />
          </div>
        </div>
      </div>

      {/* HIZLI MÜŞTERİ / TENANT IT MÜDAHALE & UZAKTAN ERİŞİM ÇUBUĞU */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-xl p-3.5 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Server size={18} className="text-blue-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200">İşletme IT Operasyonu:</span>
          <select
            value={selectedTenantFilter}
            onChange={e => setSelectedTenantFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
          >
            <option value="ALL">Tüm İşletmeler ({tenants.length})</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
        </div>

        {selectedTenantFilter !== 'ALL' && (
          <div className="flex items-center gap-2 w-full md:w-auto justify-end animate-in fade-in">
            {/* Uzaktan Bağlan Butonu */}
            <button
              onClick={() => {
                const target = tenants.find(t => t.id === selectedTenantFilter);
                if (target) setRemoteSessionTarget(target);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
            >
              <Monitor size={14} />
              <span>İşletme Ekranına Bağlan (Live View)</span>
            </button>

            {/* IT Toolkit Butonu */}
            <button
              onClick={() => {
                const target = tenants.find(t => t.id === selectedTenantFilter);
                if (target) setItActionTarget(target);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
            >
              <Wrench size={14} />
              <span>IT Müdahale Araçları (Toolkit)</span>
            </button>
          </div>
        )}
      </div>

      {/* ARAMA VE KATEGORİ SEKMELERİ */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Arama Kutusu */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="İşlem, hata kodu (ERR_*), kullanıcı, IP, hash veya işletme ara..."
              className="w-full bg-slate-800/90 border border-slate-700 pl-10 pr-4 py-2 rounded-xl text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono shadow-inner"
            />
          </div>

          {/* Önem Derecesi Filtresi */}
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 rounded-xl p-1 shrink-0 overflow-x-auto">
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map(sev => (
              <button
                key={sev}
                onClick={() => setSelectedSeverity(sev)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  selectedSeverity === sev
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sev === 'ALL' ? 'Tüm Seviyeler' : sev}
              </button>
            ))}
          </div>
        </div>

        {/* Kategori Sekmeleri */}
        <div className="flex gap-2 overflow-x-auto pb-1 text-xs font-medium">
          <button
            onClick={() => setCategoryTab('ALL')}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              categoryTab === 'ALL'
                ? 'bg-slate-700 text-white border-slate-500 font-semibold'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            Tüm Olaylar ({logs.length})
          </button>
          <button
            onClick={() => setCategoryTab('CRITICAL_ONLY')}
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              categoryTab === 'CRITICAL_ONLY'
                ? 'bg-red-950 text-red-200 border-red-600 font-semibold'
                : 'bg-slate-800/60 text-red-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            <AlertOctagon size={13} />
            Yalnızca Kritik &amp; Yüksek ({stats.critical + stats.high})
          </button>
          <button
            onClick={() => setCategoryTab('HARDWARE')}
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              categoryTab === 'HARDWARE'
                ? 'bg-cyan-950 text-cyan-200 border-cyan-600 font-semibold'
                : 'bg-slate-800/60 text-cyan-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            <Cpu size={13} />
            Donanım &amp; Terminal ({stats.hardware})
          </button>
          <button
            onClick={() => setCategoryTab('SYNC')}
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              categoryTab === 'SYNC'
                ? 'bg-blue-950 text-blue-200 border-blue-600 font-semibold'
                : 'bg-slate-800/60 text-blue-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            <Radio size={13} />
            Senkronizasyon ({stats.sync})
          </button>
          <button
            onClick={() => setCategoryTab('SECURITY')}
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              categoryTab === 'SECURITY'
                ? 'bg-purple-950 text-purple-200 border-purple-600 font-semibold'
                : 'bg-slate-800/60 text-purple-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            <Shield size={13} />
            Güvenlik &amp; Yetki
          </button>
          <button
            onClick={() => setCategoryTab('PAYMENT')}
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              categoryTab === 'PAYMENT'
                ? 'bg-amber-950 text-amber-200 border-amber-600 font-semibold'
                : 'bg-slate-800/60 text-amber-400 border-slate-700/60 hover:bg-slate-800'
            }`}
          >
            <Zap size={13} />
            Ödeme &amp; Mali Hatalar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-xl px-4 py-2.5 text-xs flex items-center gap-2">
          <AlertOctagon size={16} className="text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* DENETİM VE TEŞHİS TABLOSU */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={24} className="animate-spin text-indigo-400" />
          <span className="text-sm">IT Denetim Defteri ve olay kayıtları yükleniyor...</span>
        </div>
      ) : (
        <div className="border border-slate-700/90 rounded-2xl overflow-hidden bg-slate-900/80 shadow-xl max-h-[62vh] overflow-y-auto font-sans">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/95 text-slate-200 sticky top-0 border-b border-slate-700 z-10 font-semibold tracking-wider uppercase text-[11px]">
              <tr>
                <th className="p-3 font-mono">Sıra</th>
                <th className="p-3">Zaman</th>
                <th className="p-3">Seviye &amp; Hata Kodu</th>
                <th className="p-3">İşlem / Eylem (Action)</th>
                <th className="p-3">İşletme / Tenant</th>
                <th className="p-3">Aktör &amp; IP</th>
                <th className="p-3 font-mono">SHA-256 Zinciri</th>
                <th className="p-3 text-right">IT Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredLogs.map(log => {
                const sev = log.severity || 'INFO';
                const colorConfig = SEVERITY_COLORS[sev] || SEVERITY_COLORS.INFO;

                return (
                  <tr
                    key={log.id}
                    onClick={() => setDetailModalLog(log)}
                    className="hover:bg-slate-800/60 cursor-pointer transition-colors group"
                  >
                    {/* Sıra No */}
                    <td className="p-3 font-mono text-slate-400 font-semibold">
                      #{log.sequence}
                    </td>

                    {/* Zaman */}
                    <td className="p-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR') : '—'}
                    </td>

                    {/* Seviye & Hata Kodu */}
                    <td className="p-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${colorConfig.badge}`}>
                          {sev}
                        </span>
                        {log.errorCode && (
                          <span className="font-mono text-[10px] text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                            {log.errorCode}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* İşlem Adı */}
                    <td className="p-3">
                      <div className={`font-semibold text-xs ${colorConfig.text} group-hover:underline`}>
                        {log.action}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 truncate max-w-[200px]">
                        Ref: {log.resourceId}
                      </div>
                    </td>

                    {/* İşletme / Tenant */}
                    <td className="p-3">
                      <div className="text-white font-medium text-xs">
                        {log.tenantName || 'Platform Geneli'}
                      </div>
                      {log.tenantId && (
                        <div className="font-mono text-[10px] text-slate-400">
                          {log.tenantId}
                        </div>
                      )}
                    </td>

                    {/* Aktör & IP */}
                    <td className="p-3">
                      <div className="font-mono text-slate-200 text-xs">
                        {log.actorId}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <span>{ROLE_LABELS[log.actorRole] || log.actorRole}</span>
                        {log.ipAddress && <span className="text-cyan-400 font-mono">({log.ipAddress})</span>}
                      </div>
                    </td>

                    {/* SHA-256 Hash */}
                    <td className="p-3 font-mono text-slate-400 hover:text-emerald-400 transition-colors" title={log.hash}>
                      {log.hash ? log.hash.slice(0, 10) + '…' + log.hash.slice(-4) : '—'}
                    </td>

                    {/* IT Aksiyon Butonları */}
                    <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {log.tenantId && log.tenantId !== 'DEFAULT_TENANT' && (
                          <button
                            onClick={() => {
                              const tenantObj = tenants.find(t => t.id === log.tenantId) || {
                                id: log.tenantId!,
                                name: log.tenantName || log.tenantId!,
                                status: 'ACTIVE',
                              };
                              setRemoteSessionTarget(tenantObj);
                            }}
                            className="p-1.5 rounded-lg bg-blue-950/60 hover:bg-blue-800 text-blue-300 border border-blue-700/60 transition-colors"
                            title="İşletme Ekranına Bağlan (Canlı Gözlemci/Debug)"
                          >
                            <Monitor size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => setDetailModalLog(log)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                          title="Detaylı Teşhis & Stack Trace İncele"
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-500">
                    Kriterlere uygun herhangi bir IT teşhis veya güvenlik kaydı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODALLAR */}
      {remoteSessionTarget && (
        <RemoteSessionModal
          tenantId={remoteSessionTarget.id}
          tenantName={remoteSessionTarget.name}
          isOpen={!!remoteSessionTarget}
          onClose={() => setRemoteSessionTarget(null)}
        />
      )}

      {itActionTarget && (
        <ITActionModal
          tenantId={itActionTarget.id}
          tenantName={itActionTarget.name}
          isOpen={!!itActionTarget}
          onClose={() => setItActionTarget(null)}
          onActionComplete={loadData}
        />
      )}

      {detailModalLog && (
        <LogDetailModal
          log={detailModalLog}
          isOpen={!!detailModalLog}
          onClose={() => setDetailModalLog(null)}
        />
      )}
    </div>
  );
}
