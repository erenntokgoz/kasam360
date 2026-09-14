import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { Monitor, Plus, Wifi, WifiOff, RefreshCw, Radio, Building2, CheckCircle, AlertTriangle, Power, Trash2 } from 'lucide-react';

interface DeviceDto {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: string;
  last_heartbeat: string | null;
}

interface TenantDto {
  id: string;
  name: string;
  status: string;
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  POS: 'POS Terminali',
  KDS: 'KDS Ekranı',
  PRINTER: 'Yazıcı',
};

export function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', device_type: 'POS', tenant_id: 'DEFAULT_TENANT' });
  const [saving, setSaving] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [devicesData, tenantsData] = await Promise.all([
        tauriInvoke<DeviceDto[]>('get_devices', { callerRole: 'MASTER' }),
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
      ]);
      setDevices(devicesData);
      setTenants(tenantsData);
      if (tenantsData.length > 0 && !form.tenant_id) {
        setForm(f => ({ ...f, tenant_id: tenantsData[0].id }));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form.tenant_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await tauriInvoke('register_device', {
        callerRole: 'MASTER',
        tenantId: form.tenant_id,
        name: form.name.trim(),
        deviceType: form.device_type,
      });
      setForm({ name: '', device_type: 'POS', tenant_id: tenants[0]?.id || 'DEFAULT_TENANT' });
      setShowForm(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSendHeartbeat = async (deviceId: string) => {
    setPingingId(deviceId);
    try {
      await tauriInvoke('record_device_heartbeat', { deviceId });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPingingId(null);
    }
  };

  const handleToggleStatus = async (deviceId: string) => {
    try {
      await tauriInvoke('toggle_device_status', { deviceId });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    try {
      await tauriInvoke('delete_device', { deviceId });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const formatHeartbeat = (ts: string | null) => {
    if (!ts) return 'Hiç bağlanmadı';
    const date = new Date(ts);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Şimdi';
    if (diffMin < 60) return `${diffMin} dakika önce`;
    return date.toLocaleString('tr-TR');
  };

  const isOnline = (ts: string | null) => {
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < 5 * 60 * 1000;
  };

  const getTenantName = (tId: string) => {
    const t = tenants.find(item => item.id === tId);
    return t ? t.name : tId;
  };

  const onlineCount = devices.filter(d => isOnline(d.last_heartbeat)).length;
  const offlineCount = devices.length - onlineCount;

  const filteredDevices = devices.filter(d => {
    if (typeFilter === 'ALL') return true;
    if (typeFilter === 'ONLINE') return isOnline(d.last_heartbeat);
    return d.device_type === typeFilter;
  });

  return (
    <div className="space-y-5 w-full text-left">
      {/* Üst Başlık & Butonlar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Monitor className="text-cyan-400" size={22} />
            Cihazlar &amp; Sistem Sağlığı
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tüm işletmelerdeki POS, KDS ve Yazıcı terminallerinin anlık sağlık durumu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors"
            title="Yenile"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors shadow-sm"
          >
            <Plus size={16} />
            {showForm ? 'Vazgeç' : 'Yeni Cihaz Kaydet'}
          </button>
        </div>
      </div>

      {/* KPI Kartları */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Toplam Cihaz</p>
          <p className="text-2xl font-bold text-white">{devices.length}</p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Çevrimiçi (Aktif Bağlantı)</p>
          <p className="text-2xl font-bold text-green-400 flex items-center gap-1.5">
            <Wifi size={18} />
            {onlineCount}
          </p>
        </div>
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-lg p-3">
          <p className="text-slate-400 text-xs">Çevrimdışı (Sinyal Yok)</p>
          <p className="text-2xl font-bold text-slate-400 flex items-center gap-1.5">
            <WifiOff size={18} />
            {offlineCount}
          </p>
        </div>
      </div>

      {/* Yeni Cihaz Formu */}
      {showForm && (
        <form
          onSubmit={handleRegister}
          className="bg-slate-800 border border-blue-500/40 rounded-lg p-5 space-y-4 shadow-lg"
        >
          <h3 className="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700 pb-2">
            <Plus size={18} className="text-blue-400" />
            Yeni Terminal &amp; Cihaz Kaydı
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Cihaz Adı *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Örn: Salon Kasa POS 1"
                required
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Cihaz Türü
              </label>
              <select
                value={form.device_type}
                onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="POS">POS Terminali</option>
                <option value="KDS">KDS Mutfak Ekranı</option>
                <option value="PRINTER">Sipariş / Bar Yazıcısı</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Bağlı Müşteri (Tenant)
              </label>
              <select
                value={form.tenant_id}
                onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors shadow-sm"
            >
              {saving ? 'Kaydediliyor...' : 'Cihazı Kaydet'}
            </button>
          </div>
        </form>
      )}

      {/* Filtre Butonları */}
      <div className="flex flex-wrap gap-2 pt-1">
        {[
          { id: 'ALL', label: `Tüm Cihazlar (${devices.length})` },
          { id: 'ONLINE', label: `Çevrimiçi (${onlineCount})` },
          { id: 'POS', label: 'POS Terminalleri' },
          { id: 'KDS', label: 'KDS Ekranları' },
          { id: 'PRINTER', label: 'Yazıcılar' },
        ].map(filter => (
          <button
            key={filter.id}
            onClick={() => setTypeFilter(filter.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              typeFilter === filter.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Cihaz Listesi Tablosu */}
      {loading ? (
        <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
          <RefreshCw size={18} className="animate-spin text-blue-400" />
          <span>Cihazlar yükleniyor...</span>
        </div>
      ) : (
        <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/60 shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-700/80 text-slate-100 border-b border-slate-600">
              <tr>
                <th className="p-3.5">Cihaz Adı</th>
                <th className="p-3.5">Tür</th>
                <th className="p-3.5">Müşteri (İşletme)</th>
                <th className="p-3.5">Durum</th>
                <th className="p-3.5">Son Sinyal (Heartbeat)</th>
                <th className="p-3.5 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {filteredDevices.map(d => {
                const online = isOnline(d.last_heartbeat);
                const isPinging = pingingId === d.id;
                return (
                  <tr key={d.id} className="hover:bg-slate-700/40 transition-colors">
                    <td className="p-3.5">
                      <div className="font-semibold text-white flex items-center gap-2">
                        <Monitor size={15} className="text-slate-400" />
                        {d.name}
                      </div>
                      <div className="text-xs font-mono text-slate-400">{d.id}</div>
                    </td>
                    <td className="p-3.5">
                      <span className="text-xs font-medium px-2 py-1 rounded bg-slate-700/70 text-slate-200">
                        {DEVICE_TYPE_LABELS[d.device_type] ?? d.device_type}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="text-sm text-slate-200 flex items-center gap-1.5">
                        <Building2 size={13} className="text-slate-400" />
                        {getTenantName(d.tenant_id)}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">{d.tenant_id}</div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          d.status === 'ACTIVE'
                            ? 'bg-green-950 text-green-300 border border-green-700/60'
                            : 'bg-red-950 text-red-300 border border-red-700/60'
                        }`}
                      >
                        <CheckCircle size={11} className={d.status === 'ACTIVE' ? 'text-green-400' : 'text-red-400'} />
                        {d.status === 'ACTIVE' ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        {online ? (
                          <div className="flex items-center gap-1 text-green-400">
                            <Wifi size={14} className="text-green-400" />
                            <span className="text-xs font-medium">Çevrimiçi</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-500">
                            <WifiOff size={14} className="text-slate-500" />
                            <span className="text-xs">Çevrimdışı</span>
                          </div>
                        )}
                        <span className="text-slate-400 text-xs">({formatHeartbeat(d.last_heartbeat)})</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-right flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleSendHeartbeat(d.id)}
                        disabled={isPinging}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs font-medium transition-colors disabled:opacity-50"
                        title="Canlılık sinyali gönder"
                      >
                        <Radio size={13} className={isPinging ? 'animate-pulse text-cyan-400' : 'text-cyan-400'} />
                        {isPinging ? 'Sinyal...' : 'Test'}
                      </button>
                      <button
                        onClick={() => handleToggleStatus(d.id)}
                        className={`p-1.5 rounded text-xs font-medium transition-colors border ${
                          d.status === 'ACTIVE'
                            ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border-amber-700/50'
                            : 'bg-green-950/60 hover:bg-green-900/80 text-green-300 border-green-700/50'
                        }`}
                        title={d.status === 'ACTIVE' ? 'Cihazı Pasife Al' : 'Cihazı Aktifleştir'}
                      >
                        <Power size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteDevice(d.id)}
                        className="p-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-700/50 rounded text-xs font-medium transition-colors"
                        title="Cihazı Sil"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    Filtreye uygun cihaz kaydı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
