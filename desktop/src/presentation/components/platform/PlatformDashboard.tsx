import { useState, useEffect, useCallback } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  CreditCard,
  Users,
  Wifi,
  RefreshCw,
  Clock,
  AlertOctagon,
  ShieldCheck,
} from 'lucide-react';
import { AppleGlassCard } from '../common/AppleGlassCard';
import { AppleButton } from '../common/AppleButton';
import { AppBadge } from '../common/AppBadge';

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

/**
 * Apple Dashboard standartlarında tasarlanmış Platform Operasyonel Özeti.
 * Buzlu cam kartlar (AppleGlassCard), sade tipografi ve canlı KPI metrikleri içerir.
 */
export function PlatformDashboard() {
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [users, setUsers] = useState<GlobalUserDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Platform genelindeki tüm operasyonel ve idari verileri çek
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

  // 1. Genel İşletme İstatistikleri
  const totalTenants = tenants.length;
  const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
  const suspendedTenants = tenants.filter(t => t.status === 'SUSPENDED').length;

  // 2. Aktif Cihazlar & Çevrimiçi Sağlık Kontrolü (Son 5 dakika)
  const isOnline = (ts: string | null) => {
    if (!ts) return false;
    const isoStr = ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z';
    const parsed = new Date(isoStr);
    const time = isNaN(parsed.getTime()) ? new Date(ts).getTime() : parsed.getTime();
    return Math.abs(Date.now() - time) < 5 * 60 * 1000;
  };
  const onlineDevices = devices.filter(d => isOnline(d.last_heartbeat)).length;
  const totalDevices = devices.length;
  const onlinePercent = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 0;

  // 3. Finansal KPI: Aylık Tekrarlayan Gelir (MRR) ve Yıllık (ARR)
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
      <div className="p-16 text-center text-white/50 flex flex-col items-center justify-center gap-3 text-xs font-sans">
        <RefreshCw size={24} className="animate-spin text-white/70" />
        <span className="tracking-wide">Platform verileri ve metrikleri senkronize ediliyor...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full text-left font-sans">
      {/* 1. Üst Başlık & İdari Aksiyonlar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="text-[10px] font-mono tracking-widest text-white/40 uppercase mb-1">
            YÖNETİM &bull; OPERASYONEL METRİKLER
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
            Platform Operasyonel Özeti
          </h2>
        </div>
        <AppleButton
          variant="secondary"
          size="sm"
          onClick={loadAll}
          disabled={loading}
          icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
        >
          Verileri Güncelle
        </AppleButton>
      </div>

      {/* Hata Bildirimi */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-2xl px-5 py-3.5 text-xs flex items-center gap-2.5 backdrop-blur-md">
          <AlertOctagon size={16} className="text-rose-400 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* 2. Apple Cam Kartları — 3 Ana KPI Bloğu */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* KPI 1: İşletme Hacmi */}
        <AppleGlassCard variant="regular" className="p-6 transition-all duration-200 hover:border-white/20">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">
                Kayıtlı İşletmeler
              </p>
              <h3 className="text-3xl font-semibold text-white mt-1 tracking-tight">
                {totalTenants}
              </h3>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/80 shadow-inner">
              <Building2 size={19} />
            </div>
          </div>
          <div className="pt-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white/80 font-medium">{activeTenants} Aktif İşletme</span>
            </div>
            {suspendedTenants > 0 && (
              <span className="text-amber-400 font-mono text-[11px] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                {suspendedTenants} Askıda
              </span>
            )}
          </div>
        </AppleGlassCard>

        {/* KPI 2: Donanım & Çevrimiçi Durum */}
        <AppleGlassCard variant="regular" className="p-6 transition-all duration-200 hover:border-white/20">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">
                Aktif Cihazlar &amp; Sağlık
              </p>
              <h3 className="text-3xl font-semibold text-white mt-1 tracking-tight flex items-baseline gap-2">
                <span>{onlineDevices}</span>
                <span className="text-xs font-normal text-white/40">/ {totalDevices} Terminal</span>
              </h3>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/80 shadow-inner">
              <Wifi size={19} />
            </div>
          </div>
          <div className="pt-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
            <span className="text-white/70">
              Çevrimiçi Oran: <strong className="text-white font-medium">%{onlinePercent}</strong>
            </span>
            <span className="text-white/40 text-[11px] font-mono">
              {posCount} POS &bull; {kdsCount} KDS &bull; {printerCount} Yazıcı
            </span>
          </div>
        </AppleGlassCard>

        {/* KPI 3: Gelir Akışı (MRR & ARR) */}
        <AppleGlassCard variant="regular" className="p-6 transition-all duration-200 hover:border-white/20">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">
                Aylık Tekrarlayan Gelir (MRR)
              </p>
              <h3 className="text-3xl font-semibold text-white mt-1 tracking-tight flex items-baseline gap-1">
                <span>{formatCurrency(totalMRRCents)}</span>
                <span className="text-xs font-normal text-white/40">/ ay</span>
              </h3>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/80 shadow-inner">
              <CreditCard size={19} />
            </div>
          </div>
          <div className="pt-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
            <span className="text-white/70">
              Yıllık Tahmini (ARR): <strong className="text-white font-medium">{formatCurrency(totalARRCents)}</strong>
            </span>
            <span className="text-white/40 font-mono text-[11px]">
              {subscriptions.filter(s => s.status === 'ACTIVE').length} Sözleşme
            </span>
          </div>
        </AppleGlassCard>
      </div>

      {/* 3. İkincil Metrikler & Hızlı Bakış */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Son Kayıtlı İşletmeler Cam Kartı */}
        <AppleGlassCard variant="regular" className="p-6 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80 flex items-center gap-2">
            <Building2 size={16} className="text-white/60" />
            <span>Son Kayıtlı İşletmeler</span>
          </h3>
          <div className="space-y-2.5">
            {tenants.slice(0, 4).map(t => {
              const plan = plans.find(p => p.id === t.plan_id);
              const isActive = t.status === 'ACTIVE';
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-all text-xs"
                >
                  <div>
                    <span className="font-medium text-white block">{t.name}</span>
                    <span className="text-white/40 font-mono text-[11px]">{t.id}</span>
                  </div>
                  <div className="text-right flex items-center gap-2.5">
                    <span className="text-white/50 text-[11px]">
                      {plan ? plan.name : 'Paketsiz'}
                    </span>
                    <AppBadge variant={isActive ? 'success' : 'danger'}>
                      {isActive ? 'Aktif' : 'Askıda'}
                    </AppBadge>
                  </div>
                </div>
              );
            })}
            {tenants.length === 0 && (
              <p className="text-white/40 text-xs py-6 text-center">Henüz müşteri kaydı bulunmuyor.</p>
            )}
          </div>
        </AppleGlassCard>

        {/* Personel ve Güvenlik Altyapısı Cam Kartı */}
        <AppleGlassCard variant="regular" className="p-6 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80 flex items-center gap-2">
            <Users size={16} className="text-white/60" />
            <span>Personel &amp; Güvenlik Altyapısı</span>
          </h3>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
              <span className="text-white/40 text-[11px] block uppercase font-medium">Toplam Personel</span>
              <span className="text-2xl font-semibold text-white mt-1 block tracking-tight">{users.length}</span>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 text-center">
              <span className="text-white/40 text-[11px] block uppercase font-medium">Denetim Günlüğü</span>
              <span className="text-2xl font-semibold text-white mt-1 block tracking-tight">{auditLogs.length}</span>
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between text-xs text-white/60">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-400" />
              <span>SHA-256 Değiştirilemez Kriptografik İz</span>
            </div>
            <span className="font-mono text-emerald-400 text-[11px]">Doğrulandı</span>
          </div>
        </AppleGlassCard>
      </div>

      {/* 4. Son Denetim Aktiviteleri Tablosu */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80 flex items-center gap-2">
          <Clock size={16} className="text-white/60" />
          <span>Son Sistem Denetim Olayları ({auditLogs.length})</span>
        </h3>
        <AppleGlassCard variant="regular" className="overflow-hidden p-0 rounded-3xl border border-white/[0.08]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-white/80">
              <thead className="bg-white/[0.03] text-white/50 text-[11px] font-medium uppercase tracking-wider border-b border-white/[0.06]">
                <tr>
                  <th className="py-3.5 px-5">Sıra</th>
                  <th className="py-3.5 px-5">Zaman</th>
                  <th className="py-3.5 px-5">Kullanıcı (Actor)</th>
                  <th className="py-3.5 px-5">İşlem (Action)</th>
                  <th className="py-3.5 px-5">Kaynak ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {auditLogs.slice(0, 6).map(log => (
                  <tr key={log.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-3.5 px-5 font-mono text-white/40 font-medium">{log.sequence}</td>
                    <td className="py-3.5 px-5 text-white/60 text-xs">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR') : '—'}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs text-white/70">
                      {log.actorId ? log.actorId.slice(0, 10) + '…' : '—'}
                    </td>
                    <td className="py-3.5 px-5 font-medium text-white">{log.action}</td>
                    <td className="py-3.5 px-5 font-mono text-xs text-white/40">
                      {log.resourceId ? log.resourceId.slice(0, 12) + '…' : '—'}
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-white/40 text-xs">
                      Henüz kayıtlı bir denetim olayı bulunmamaktadır.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AppleGlassCard>
      </div>
    </div>
  );
}
