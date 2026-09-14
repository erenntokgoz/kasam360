import { useState } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  X,
  CheckCircle2,
  AlertOctagon,
  CreditCard,
  Monitor,
  Users,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Key,
} from 'lucide-react';
import { MasterVaultModal } from './MasterVaultModal';

export interface TenantDto {
  id: string;
  name: string;
  status: string;
  plan_id: string | null;
  created_at: string;
  contact_person?: string;
  email?: string;
  phone?: string;
}

export interface PlanDto {
  id: string;
  name: string;
  monthly_price_cents: number;
  max_devices: number;
  max_users: number;
  max_branches?: number;
  features?: string[];
  badge?: string;
}

export interface DeviceDto {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: string;
  last_heartbeat: string | null;
}

export interface GlobalUserDto {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
}

export interface SubscriptionDto {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  renews_at: string | null;
}

interface TenantDetailModalProps {
  tenant: TenantDto;
  plans: PlanDto[];
  devices: DeviceDto[];
  users: GlobalUserDto[];
  subscriptions: SubscriptionDto[];
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function TenantDetailModal({
  tenant,
  plans,
  devices,
  users,
  subscriptions,
  isOpen,
  onClose,
  onRefresh,
}: TenantDetailModalProps) {
  const [activeSubTab, setActiveSubTab] = useState<'OVERVIEW' | 'SUBSCRIPTION' | 'DEVICES' | 'USERS'>('OVERVIEW');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(tenant.plan_id || (plans[0]?.id ?? ''));
  const [addDays, setAddDays] = useState<number>(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [vaultUser, setVaultUser] = useState<GlobalUserDto | null>(null);

  const isTenantActive = tenant.status?.toUpperCase() === 'ACTIVE';

  if (!isOpen) return null;

  const currentSub = subscriptions.find(s => s.tenant_id === tenant.id);
  const currentPlan = plans.find(p => p.id === (currentSub?.plan_id || tenant.plan_id));
  const tenantDevices = devices.filter(d => d.tenant_id === tenant.id);
  const tenantUsers = users.filter(u => u.tenant_id === tenant.id && u.id !== 'usr_master' && u.role !== 'MASTER');

  const handleCopyId = () => {
    navigator.clipboard.writeText(tenant.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleStatus = async () => {
    setIsProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (isTenantActive) {
        await tauriInvoke('suspend_tenant', { callerRole: 'MASTER', tenantId: tenant.id });
        setSuccessMsg('İşletme başarıyla askıya alındı / bekletmeye alındı.');
      } else {
        await tauriInvoke('activate_tenant', { callerRole: 'MASTER', tenantId: tenant.id });
        setSuccessMsg('İşletme başarıyla aktifleştirildi.');
      }
      await onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId) return;
    setIsProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await tauriInvoke('update_tenant_subscription', {
        callerRole: 'MASTER',
        tenantId: tenant.id,
        planId: selectedPlanId,
        addDays: Number(addDays),
      });
      setSuccessMsg(`Abonelik başarıyla güncellendi (+${addDays} gün eklendi).`);
      await onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const isOnline = (ts: string | null) => {
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < 5 * 60 * 1000;
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Başlığı */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600/20 border border-blue-500/30 rounded-xl text-blue-400">
              <Building2 size={28} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-white">{tenant.name}</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    isTenantActive
                      ? 'bg-green-950 text-green-300 border border-green-700/60'
                      : 'bg-red-950 text-red-300 border border-red-700/60'
                  }`}
                >
                  {isTenantActive ? (
                    <>
                      <CheckCircle2 size={12} className="text-green-400" /> Aktif
                    </>
                  ) : (
                    <>
                      <AlertOctagon size={12} className="text-red-400" /> Askıda
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono text-slate-400">ID: {tenant.id}</span>
                <button
                  onClick={handleCopyId}
                  className="text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors"
                  title="ID Kopyala"
                >
                  {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal İçi Sekmeler */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-950/30 text-xs font-medium">
          {[
            { id: 'OVERVIEW', label: 'Genel Bakış & Durum' },
            { id: 'SUBSCRIPTION', label: `Abonelik & Süre Uzatma (${currentPlan?.name ?? 'Paket'})` },
            { id: 'DEVICES', label: `Bağlı Cihazlar (${tenantDevices.length})` },
            { id: 'USERS', label: `Personel & Roller (${tenantUsers.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as 'OVERVIEW' | 'SUBSCRIPTION' | 'DEVICES' | 'USERS')}
              className={`py-3 px-4 border-b-2 transition-colors ${
                activeSubTab === tab.id
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Gövdesi */}
        <div className="p-6 overflow-y-auto space-y-4 text-left flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
              <AlertOctagon size={16} className="text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-green-950/60 border border-green-800 text-green-300 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* SEKME 1: GENEL BAKIŞ & HIZLI EYLEMLER */}
          {activeSubTab === 'OVERVIEW' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                  <span className="text-slate-400 text-xs block mb-1">Mevcut Durum</span>
                  <span className={`text-base font-bold ${isTenantActive ? 'text-green-400' : 'text-red-400'}`}>
                    {isTenantActive ? 'Aktif İşletme' : 'Askıda / Beklemede'}
                  </span>
                </div>
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                  <span className="text-slate-400 text-xs block mb-1">Abonelik Paketi</span>
                  <span className="text-base font-bold text-white">
                    {currentPlan ? currentPlan.name : 'Paket Yok'}
                  </span>
                </div>
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                  <span className="text-slate-400 text-xs block mb-1">Bağlı Cihaz</span>
                  <span className="text-base font-bold text-cyan-400">
                    {tenantDevices.length} Terminal
                  </span>
                </div>
                <div className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-3.5">
                  <span className="text-slate-400 text-xs block mb-1">Personel</span>
                  <span className="text-base font-bold text-purple-400">
                    {tenantUsers.length} Kişi
                  </span>
                </div>
              </div>

              {/* Hızlı İşletme Durum Butonu */}
              <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-white">İşletme Erişim Durumu</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isTenantActive
                      ? 'İşletme şu anda aktif. Dilediğiniz zaman sistemi bekletmeye alabilirsiniz.'
                      : 'İşletme askıya alınmış. POS ve KDS terminallerinin erişimi kilitlidir.'}
                  </p>
                </div>
                <button
                  onClick={handleToggleStatus}
                  disabled={isProcessing}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    isTenantActive
                      ? 'bg-orange-600 hover:bg-orange-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isProcessing
                    ? 'İşleniyor...'
                    : isTenantActive
                    ? 'Müşteriyi Askıya Al (Beklet)'
                    : 'Müşteriyi Aktifleştir'}
                </button>
              </div>

              <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 text-xs space-y-2">
                <h4 className="font-semibold text-slate-300">Kayıt Detayları &amp; İletişim</h4>
                <div className="grid grid-cols-2 gap-2 text-slate-400">
                  <div>Kayıt Tarihi: <span className="text-slate-200">{tenant.created_at ? new Date(tenant.created_at).toLocaleString('tr-TR') : '—'}</span></div>
                  <div>Yenileme Tarihi: <span className="text-slate-200">{currentSub?.renews_at ? new Date(currentSub.renews_at).toLocaleDateString('tr-TR') : 'Belirtilmedi'}</span></div>
                  {tenant.contact_person && <div>Yetkili: <span className="text-slate-200">{tenant.contact_person}</span></div>}
                  {tenant.email && <div>E-posta: <span className="text-slate-200">{tenant.email}</span></div>}
                  {tenant.phone && <div>Telefon: <span className="text-slate-200">{tenant.phone}</span></div>}
                </div>
              </div>
            </div>
          )}

          {/* SEKME 2: ABONELİK UZATMA & PLAN DEĞİŞTİRME */}
          {activeSubTab === 'SUBSCRIPTION' && (
            <form onSubmit={handleUpdateSubscription} className="space-y-4">
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <CreditCard size={16} className="text-indigo-400" />
                  Abonelik Paketi &amp; Süre Yönetimi
                </h4>
                <p className="text-xs text-slate-400">
                  İşletmenin mevcut planını değiştirebilir veya süresini dilediğiniz gün kadar uzatabilirsiniz.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Abonelik Paketi Seçin
                    </label>
                    <select
                      value={selectedPlanId}
                      onChange={e => setSelectedPlanId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    >
                      {plans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {formatPrice(p.monthly_price_cents)}/ay ({p.max_devices} Cihaz, {p.max_users} Kullanıcı)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Süre Uzatma (Gün)
                    </label>
                    <div className="flex gap-2">
                      {[30, 90, 365].map(days => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setAddDays(days)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                            addDays === days
                              ? 'bg-blue-600 border-blue-500 text-white font-semibold'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          +{days} Gün
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Özel Gün Ekle:
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={addDays}
                    onChange={e => setAddDays(Number(e.target.value))}
                    className="w-32 bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isProcessing || !selectedPlanId}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                  {isProcessing ? 'Güncelleniyor...' : 'Aboneliği Kaydet & Uzat'}
                </button>
              </div>
            </form>
          )}

          {/* SEKME 3: BAĞLI CİHAZLAR */}
          {activeSubTab === 'DEVICES' && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Monitor size={16} className="text-cyan-400" />
                Bu Müşteriye Kayıtlı Cihazlar ({tenantDevices.length})
              </h4>

              <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/40">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800 text-slate-200 border-b border-slate-700">
                    <tr>
                      <th className="p-3">Cihaz Adı</th>
                      <th className="p-3">Tür</th>
                      <th className="p-3">Durum</th>
                      <th className="p-3">Son Bağlantı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {tenantDevices.map(d => {
                      const online = isOnline(d.last_heartbeat);
                      return (
                        <tr key={d.id} className="hover:bg-slate-700/30">
                          <td className="p-3 font-medium text-white flex items-center gap-1.5">
                            <Monitor size={14} className="text-slate-400" />
                            {d.name}
                          </td>
                          <td className="p-3">{d.device_type}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              d.status === 'ACTIVE' ? 'bg-green-950 text-green-300' : 'bg-red-950 text-red-300'
                            }`}>
                              {d.status === 'ACTIVE' ? 'Aktif' : 'Pasif'}
                            </span>
                          </td>
                          <td className="p-3 flex items-center gap-1.5">
                            {online ? (
                              <Wifi size={13} className="text-green-400" />
                            ) : (
                              <WifiOff size={13} className="text-slate-500" />
                            )}
                            <span className="text-slate-400">
                              {d.last_heartbeat ? new Date(d.last_heartbeat).toLocaleTimeString('tr-TR') : 'Hiç bağlanmadı'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {tenantDevices.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-500">
                          Bu müşteriye kayıtlı cihaz bulunmuyor.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SEKME 4: BAĞLI PERSONEL & ROLLER */}
          {activeSubTab === 'USERS' && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users size={16} className="text-purple-400" />
                Bu Müşteriye Kayıtlı Personeller ({tenantUsers.length})
              </h4>

              <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/40">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800 text-slate-200 border-b border-slate-700">
                    <tr>
                      <th className="p-3">Ad Soyad</th>
                      <th className="p-3">Rol</th>
                      <th className="p-3">Kullanıcı ID</th>
                      <th className="p-3 text-right">Giriş Bilgileri</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {tenantUsers.map(u => (
                      <tr key={u.id} className="hover:bg-slate-700/30">
                        <td className="p-3 font-semibold text-white">{u.name}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-700 text-slate-200">
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-slate-400">{u.id}</td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => setVaultUser(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-950/70 hover:bg-purple-900 border border-purple-700/60 text-purple-300 rounded text-xs font-medium transition-colors"
                            title="Şifre & Mail Göster (Güvenlik Kasası)"
                          >
                            <Key size={12} />
                            <span>Kasa</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {tenantUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-500">
                          Bu müşteriye kayıtlı personel bulunmuyor.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Alt Çubuğu */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>

      {/* GÜVENLİK KASASI (VAULT) MODALI */}
      {vaultUser && (
        <MasterVaultModal
          isOpen={!!vaultUser}
          user={vaultUser}
          onClose={() => setVaultUser(null)}
        />
      )}
    </div>
  );
}
