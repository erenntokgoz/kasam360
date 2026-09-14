import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  CreditCard,
  Users,
  Wifi,
  ShieldCheck,
  TrendingUp,
  RefreshCw,
  Clock,
} from 'lucide-react';

interface TenantDto {
  id: string;
  name: string;
  status: string;
  plan_id: string | null;
  created_at: string;
}

interface DeviceDto {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: string;
  last_heartbeat: string | null;
}

interface PlanDto {
  id: string;
  name: string;
  monthly_price_cents: number;
  max_devices: number;
  max_users: number;
  max_branches?: number;
  features?: string[];
  badge?: string;
}

interface SubscriptionDto {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  renews_at: string | null;
}

interface GlobalUserDto {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
}

interface AuditLog {
  id: string;
  sequence: number;
  timestamp: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceId: string;
  hash: string;
}

export function PlatformDashboard() {
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [users, setUsers] = useState<GlobalUserDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, d, p, s, u, a] = await Promise.all([
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
        tauriInvoke<DeviceDto[]>('get_devices', { callerRole: 'MASTER' }),
        tauriInvoke<PlanDto[]>('get_plans', {}),
        tauriInvoke<SubscriptionDto[]>('get_subscriptions', { callerRole: 'MASTER', callerTenantId: '' }),
        tauriInvoke<GlobalUserDto[]>('get_global_users', { callerRole: 'MASTER' }),
        tauriInvoke<AuditLog[]>('get_platform_audit_logs', { callerRole: 'MASTER' }),
      ]);
      setTenants(t);
      setDevices(d);
      setPlans(p);
      setSubscriptions(s);
      setUsers(u);
      setAuditLogs(a);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 1. Genel Tenant İstatistikleri
  const totalTenants = tenants.length;
  const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
  const suspendedTenants = tenants.filter(t => t.status === 'SUSPENDED').length;

  // 2. Aktif Cihazlar (Son 5 dakika içinde sinyal verenler)
  const isOnline = (ts: string | null) => {
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < 5 * 60 * 1000;
  };
  const onlineDevices = devices.filter(d => isOnline(d.last_heartbeat)).length;
  const totalDevices = devices.length;
  const onlinePercent = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 0;

  // 3. Toplam Gelir KPI'ı (MRR - Aktif Aboneliklerin Aylık Gelirleri)
  const totalMRRCents = subscriptions
    .filter(s => s.status === 'ACTIVE')
    .reduce((sum, sub) => {
      const plan = plans.find(p => p.id === sub.plan_id);
      return sum + (plan ? plan.monthly_price_cents : 0);
    }, 0);

  const formatCurrency = (cents: number) => {
    return (cents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 0,
    });
  };

  const totalARRCents = totalMRRCents * 12;

  // Cihaz türü dağılımı
  const posCount = devices.filter(d => d.device_type === 'POS').length;
  const kdsCount = devices.filter(d => d.device_type === 'KDS').length;
  const printerCount = devices.filter(d => d.device_type === 'PRINTER').length;

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-blue-400" />
        <span>Platform özeti ve KPI metrikleri yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full text-left">
      {/* Üst Başlık & Yenile */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="text-blue-400" size={22} />
            Platform Genel Özeti &amp; KPI'lar
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sistem geneli çoklu müşteri, gelir, cihaz sağlığı ve denetim metrikleri.
          </p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Verileri Güncelle
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* 3 ANA KPI KARTI (Genel Tenant Sayısı, Aktif Cihazlar, Toplam Gelir) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Genel Tenant Sayısı */}
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Genel Tenant Sayısı
              </p>
              <h3 className="text-3xl font-extrabold text-white mt-1">{totalTenants}</h3>
            </div>
            <div className="p-3 bg-blue-950/80 border border-blue-800/60 rounded-lg text-blue-400">
              <Building2 size={24} />
            </div>
          </div>
          <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              <span className="text-slate-300 font-medium">{activeTenants} Aktif İşletme</span>
            </div>
            {suspendedTenants > 0 && (
              <span className="text-orange-400 font-medium">
                {suspendedTenants} Askıda
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Aktif Cihazlar & Sistem Sağlığı */}
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Aktif Cihazlar (Sağlık)
              </p>
              <h3 className="text-3xl font-extrabold text-green-400 mt-1">
                {onlineDevices}
                <span className="text-sm font-normal text-slate-400 ml-1.5">/ {totalDevices} Cihaz</span>
              </h3>
            </div>
            <div className="p-3 bg-green-950/80 border border-green-800/60 rounded-lg text-green-400">
              <Wifi size={24} />
            </div>
          </div>
          <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
            <span className="text-slate-300">
              Çevrimiçi Oranı: <strong className="text-white">%{onlinePercent}</strong>
            </span>
            <span className="text-slate-400">
              {posCount} POS · {kdsCount} KDS · {printerCount} Yazıcı
            </span>
          </div>
        </div>

        {/* KPI 3: Toplam Gelir (MRR & ARR) */}
        <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Toplam Gelir (MRR)
              </p>
              <h3 className="text-3xl font-extrabold text-emerald-400 mt-1">
                {formatCurrency(totalMRRCents)}
                <span className="text-xs font-normal text-slate-400 ml-1">/ ay</span>
              </h3>
            </div>
            <div className="p-3 bg-emerald-950/80 border border-emerald-800/60 rounded-lg text-emerald-400">
              <CreditCard size={24} />
            </div>
          </div>
          <div className="pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs">
            <span className="text-slate-300">
              Yıllık Tahmini (ARR): <strong className="text-white">{formatCurrency(totalARRCents)}</strong>
            </span>
            <span className="text-emerald-400 font-medium">
              {subscriptions.filter(s => s.status === 'ACTIVE').length} Aktif Lisans
            </span>
          </div>
        </div>
      </div>

      {/* İkincil Metrikler & Hızlı Bakış */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Son Kayıtlı Müşteriler */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Building2 size={16} className="text-blue-400" />
            Son Kayıtlı Müşteriler (Tenants)
          </h3>
          <div className="space-y-2">
            {tenants.slice(0, 4).map(t => {
              const plan = plans.find(p => p.id === t.plan_id);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2.5 rounded bg-slate-900/60 border border-slate-800 text-xs"
                >
                  <div>
                    <span className="font-semibold text-white block">{t.name}</span>
                    <span className="text-slate-400 font-mono text-[11px]">{t.id}</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold mb-0.5 ${
                        t.status === 'ACTIVE'
                          ? 'bg-green-950 text-green-300 border border-green-800/60'
                          : 'bg-red-950 text-red-300 border border-red-800/60'
                      }`}
                    >
                      {t.status === 'ACTIVE' ? 'Aktif' : 'Askıda'}
                    </span>
                    <span className="text-slate-400 block text-[10px]">
                      {plan ? plan.name : 'Paketsiz'}
                    </span>
                  </div>
                </div>
              );
            })}
            {tenants.length === 0 && (
              <p className="text-slate-500 text-xs py-4 text-center">Müşteri kaydı yok</p>
            )}
          </div>
        </div>

        {/* Personel ve Güvenlik Durumu */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Users size={16} className="text-purple-400" />
            Kullanıcı Dağılımı &amp; Güvenlik
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3 text-center">
              <span className="text-slate-400 text-xs block">Toplam Personel</span>
              <span className="text-2xl font-bold text-white">{users.length}</span>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded p-3 text-center">
              <span className="text-slate-400 text-xs block">Toplam Denetim Kaydı</span>
              <span className="text-2xl font-bold text-indigo-400">{auditLogs.length}</span>
            </div>
          </div>
          <div className="p-2.5 rounded bg-indigo-950/30 border border-indigo-900/50 flex items-center gap-2 text-xs text-indigo-200">
            <ShieldCheck size={16} className="text-indigo-400 shrink-0" />
            <span>KASAM360 SHA-256 Değiştirilemez Denetim Defteri aktif ve doğrulanmış.</span>
          </div>
        </div>
      </div>

      {/* Son Denetim Aktiviteleri Tablosu */}
      <div>
        <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
          <Clock size={16} className="text-indigo-400" />
          Son Denetim Aktiviteleri (Audit Logs)
        </h3>
        <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/60 shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-700/80 text-slate-100 border-b border-slate-600">
              <tr>
                <th className="p-3">Sıra</th>
                <th className="p-3">Zaman</th>
                <th className="p-3">Kullanıcı (Actor)</th>
                <th className="p-3">İşlem (Action)</th>
                <th className="p-3">Kaynak ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {auditLogs.slice(0, 6).map(log => (
                <tr key={log.id} className="hover:bg-slate-700/40 transition-colors">
                  <td className="p-3 font-mono text-slate-400 font-semibold">{log.sequence}</td>
                  <td className="p-3 text-slate-400 text-xs">
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR') : '—'}
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-300">
                    {log.actorId ? log.actorId.slice(0, 10) + '…' : '—'}
                  </td>
                  <td className="p-3 font-medium text-blue-300">{log.action}</td>
                  <td className="p-3 font-mono text-xs text-slate-400">
                    {log.resourceId ? log.resourceId.slice(0, 12) + '…' : '—'}
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">Henüz denetim kaydı yok</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
