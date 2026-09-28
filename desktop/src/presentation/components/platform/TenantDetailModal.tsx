import { useState } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Building2,
  X,
  CheckCircle2,
  AlertOctagon,
  Monitor,
  Users,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Key,
  Package,
} from 'lucide-react';
import { MasterVaultModal } from './MasterVaultModal';

export interface TenantDto {
  id: string;
  name: string;
  status: string;
  modules: string[];
  created_at: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  tax_office?: string;
  address?: string;
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

interface TenantDetailModalProps {
  tenant: TenantDto;
  devices: DeviceDto[];
  users: GlobalUserDto[];
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

const AVAILABLE_MODULES = [
  { id: 'core', name: 'Temel Restoran Yönetimi' },
  { id: 'inventory', name: 'Stok Takip Modülü' },
  { id: 'delivery', name: 'Kurye Takip Modülü' },
  { id: 'qr_menu', name: 'QR Menü Modülü' },
  { id: 'online_order', name: 'Getir/Yemeksepeti Entegrasyonu' },
  { id: 'pos_integrations', name: 'Harici POS Entegrasyonu' },
];

export function TenantDetailModal({
  tenant,
  devices,
  users,
  isOpen,
  onClose,
  onRefresh,
}: TenantDetailModalProps) {
  const [selectedModules, setSelectedModules] = useState<string[]>(tenant.modules || []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [vaultUser, setVaultUser] = useState<GlobalUserDto | null>(null);

  const isTenantActive = tenant.status?.toUpperCase() === 'ACTIVE';

  if (!isOpen) return null;

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

  const handleUpdateModules = async () => {
    setIsProcessing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await tauriInvoke('update_tenant_modules', {
        callerRole: 'MASTER',
        tenantId: tenant.id,
        modules: selectedModules,
      });
      setSuccessMsg('İşletme modülleri başarıyla güncellendi.');
      await onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const isOnline = (ts: string | null) => {
    if (!ts) return false;
    const isoStr = ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z';
    const parsed = new Date(isoStr);
    const time = isNaN(parsed.getTime()) ? new Date(ts).getTime() : parsed.getTime();
    return Math.abs(Date.now() - time) < 5 * 60 * 1000;
  };

  const toggleModule = (modId: string) => {
    if (selectedModules.includes(modId)) {
      setSelectedModules(selectedModules.filter(id => id !== modId));
    } else {
      setSelectedModules([...selectedModules, modId]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Başlığı */}
        <div className="p-6 border-b dark:border-white/10 border-black/[0.08] flex items-center justify-between dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-[#007AFF]/15 border border-[#007AFF]/30 rounded-2xl text-[#007AFF]">
              <Building2 size={28} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold dark:text-white text-zinc-900">{tenant.name}</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    isTenantActive
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                  }`}
                >
                  {isTenantActive ? (
                    <>
                      <CheckCircle2 size={12} className="text-emerald-500" /> Aktif
                    </>
                  ) : (
                    <>
                      <AlertOctagon size={12} className="text-rose-500" /> Askıda
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">ID: {tenant.id}</span>
                <button
                  onClick={handleCopyId}
                  className="dark:text-zinc-400 text-zinc-500 hover:dark:text-zinc-200 hover:text-zinc-900 p-0.5 rounded transition-colors cursor-pointer"
                  title="ID Kopyala"
                >
                  {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Gövdesi - Tek Scrollable Görünüm */}
        <div className="p-6 overflow-y-auto space-y-8 text-left flex-1">
          {error && (
            <div className="p-3 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-500 text-xs flex items-center gap-2">
              <AlertOctagon size={16} className="text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Hızlı İşletme Durum Butonu & İletişim Bilgileri */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-4 text-xs space-y-2 shadow-sm">
              <h4 className="font-semibold dark:text-zinc-300 text-zinc-700 mb-3 border-b dark:border-white/10 border-black/[0.08] pb-2">Kayıt Detayları &amp; İletişim</h4>
              <div className="grid grid-cols-2 gap-2 dark:text-zinc-400 text-zinc-500">
                <div>Kayıt Tarihi: <span className="dark:text-zinc-200 text-zinc-800">{tenant.created_at ? new Date(tenant.created_at).toLocaleString('tr-TR') : '—'}</span></div>
                {tenant.contact_person && <div>Yetkili: <span className="dark:text-zinc-200 text-zinc-800">{tenant.contact_person}</span></div>}
                {tenant.email && <div>E-posta: <span className="dark:text-zinc-200 text-zinc-800">{tenant.email}</span></div>}
                {tenant.phone && <div>Telefon: <span className="dark:text-zinc-200 text-zinc-800">{tenant.phone}</span></div>}
                {tenant.tax_id && <div className="col-span-2">VKN / TC No: <span className="dark:text-zinc-200 text-zinc-800 font-mono">{tenant.tax_id}</span></div>}
                {tenant.address && <div className="col-span-2">Adres: <span className="dark:text-zinc-200 text-zinc-800">{tenant.address}</span></div>}
              </div>
            </div>

            <div className="rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] p-4 flex flex-col justify-between shadow-sm">
              <div>
                <h4 className="text-sm font-semibold dark:text-white text-zinc-900">İşletme Erişim Durumu</h4>
              </div>
              <button
                onClick={handleToggleStatus}
                disabled={isProcessing}
                className={`mt-4 w-full py-2.5 rounded-2xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${
                  isTenantActive
                    ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/25'
                    : 'bg-[#34C759] hover:bg-[#30be55] text-white shadow-md shadow-[#34C759]/25'
                }`}
              >
                {isProcessing
                  ? 'İşleniyor...'
                  : isTenantActive
                  ? 'Müşteriyi Askıya Al (Beklet)'
                  : 'Müşteriyi Aktifleştir'}
              </button>
            </div>
          </div>

          {/* AKTİF MODÜLLER BÖLÜMÜ */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold dark:text-white text-zinc-900 flex items-center gap-2 border-b dark:border-white/10 border-black/[0.08] pb-2">
              <Package size={16} className="text-[#007AFF]" />
              Aktif Paketler ve Modüller
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {AVAILABLE_MODULES.map(mod => {
                const isActive = selectedModules.includes(mod.id);
                return (
                  <button
                    key={mod.id}
                    onClick={() => toggleModule(mod.id)}
                    className={`flex items-center gap-2 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-[#007AFF]/15 border-[#007AFF]/40 text-[#007AFF] font-semibold' 
                        : 'dark:bg-white/[0.04] bg-white dark:border-white/10 border-black/[0.08] dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.08] hover:bg-zinc-100 shadow-sm'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-[#007AFF] border-[#007AFF] text-white' : 'border-zinc-400'
                    }`}>
                      {isActive && <Check size={12} />}
                    </div>
                    <span className="text-xs leading-tight">{mod.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={handleUpdateModules}
                disabled={isProcessing}
                className="px-5 py-2.5 bg-[#007AFF] hover:bg-[#0071eb] disabled:opacity-50 text-white rounded-2xl text-xs font-semibold transition-all shadow-md shadow-[#007AFF]/25 cursor-pointer"
              >
                {isProcessing ? 'Kaydediliyor...' : 'Modülleri Kaydet'}
              </button>
            </div>
          </div>

          {/* BAĞLI CİHAZLAR BÖLÜMÜ */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold dark:text-white text-zinc-900 flex items-center gap-2 border-b dark:border-white/10 border-black/[0.08] pb-2">
              <Monitor size={16} className="text-cyan-500" />
              Terminaller ve Cihazlar ({tenantDevices.length})
            </h4>
            <div className="border dark:border-white/10 border-black/[0.08] rounded-2xl overflow-hidden dark:bg-white/[0.02] bg-white shadow-sm">
              <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
                <thead className="dark:bg-[#121318]/90 bg-white/95 text-xs uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
                  <tr>
                    <th className="p-3">Cihaz Adı</th>
                    <th className="p-3">Tür</th>
                    <th className="p-3">Durum</th>
                    <th className="p-3">Son Bağlantı</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-white/[0.06] divide-black/[0.06]">
                  {tenantDevices.map(d => {
                    const online = isOnline(d.last_heartbeat);
                    return (
                      <tr key={d.id} className="hover:dark:bg-white/[0.04] hover:bg-black/[0.02]">
                        <td className="p-3 font-medium dark:text-white text-zinc-900 flex items-center gap-1.5">
                          <Monitor size={14} className="text-zinc-400" />
                          {d.name}
                        </td>
                        <td className="p-3">{d.device_type}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            d.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                          }`}>
                            {d.status === 'ACTIVE' ? 'Aktif' : 'Pasif'}
                          </span>
                        </td>
                        <td className="p-3 flex items-center gap-1.5">
                          {online ? (
                            <Wifi size={13} className="text-emerald-500" />
                          ) : (
                            <WifiOff size={13} className="text-zinc-400" />
                          )}
                          <span className="dark:text-zinc-400 text-zinc-500">
                            {d.last_heartbeat ? new Date(d.last_heartbeat).toLocaleTimeString('tr-TR') : 'Hiç bağlanmadı'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {tenantDevices.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-zinc-400">
                        Bu müşteriye kayıtlı cihaz bulunmuyor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* BAĞLI PERSONEL BÖLÜMÜ */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold dark:text-white text-zinc-900 flex items-center gap-2 border-b dark:border-white/10 border-black/[0.08] pb-2">
              <Users size={16} className="text-purple-500" />
              İşletme Personelleri ({tenantUsers.length})
            </h4>
            <div className="border dark:border-white/10 border-black/[0.08] rounded-2xl overflow-hidden dark:bg-white/[0.02] bg-white shadow-sm">
              <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
                <thead className="dark:bg-[#121318]/90 bg-white/95 text-xs uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
                  <tr>
                    <th className="p-3">Ad Soyad</th>
                    <th className="p-3">Rol</th>
                    <th className="p-3">Kullanıcı ID</th>
                    <th className="p-3 text-right">Giriş Bilgileri</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-white/[0.06] divide-black/[0.06]">
                  {tenantUsers.map(u => (
                    <tr key={u.id} className="hover:dark:bg-white/[0.04] hover:bg-black/[0.02]">
                      <td className="p-3 font-semibold dark:text-white text-zinc-900">{u.name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold dark:bg-white/10 bg-black/[0.05] dark:text-zinc-200 text-zinc-800">
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3 font-mono dark:text-zinc-400 text-zinc-500">{u.id}</td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => setVaultUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-600 dark:text-purple-400 rounded-xl text-xs font-semibold transition-all cursor-pointer"
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
                      <td colSpan={4} className="p-6 text-center text-zinc-400">
                        Bu müşteriye kayıtlı personel bulunmuyor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Alt Çubuğu */}
        <div className="p-4 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
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
