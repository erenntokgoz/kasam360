import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import {
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Monitor,
  Users as UsersIcon,
  Copy,
  Check,
  Key,
  Edit2,
  ChevronLeft,
  ChevronRight,
  AlertOctagon,
  Building2,
} from 'lucide-react';
import { MasterVaultModal, VaultStaffUser } from './MasterVaultModal';
import {
  TenantDetailModal,
  TenantDto,
  DeviceDto,
  GlobalUserDto,
} from './TenantDetailModal';
import { PlatformSetupWizard } from './PlatformSetupWizard';
import { EditTenantModal } from './EditTenantModal';
import { AppleGlassCard } from '../common/AppleGlassCard';
import { AppleButton } from '../common/AppleButton';
import { AppBadge } from '../common/AppBadge';

/**
 * Apple tasarım prensiplerine uygun İşletme Yönetimi görünümü.
 * Cam kartlar (AppleGlassCard), ferah arama/filtreleme ve pürüzsüz kart etkileşimleri sunar.
 */
export function TenantManagement(): JSX.Element {
  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [users, setUsers] = useState<GlobalUserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal Durumları
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantDto | null>(null);
  const [selectedTenantForDetail, setSelectedTenantForDetail] = useState<TenantDto | null>(null);
  const [vaultUser, setVaultUser] = useState<VaultStaffUser | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Arama, Filtreleme ve Sayfalama Durumları
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 9; // 3x3 ızgara düzeni için ideal

  // Veritabanından işletme, cihaz ve kullanıcı verilerini çek
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsData, devicesData, usersData] = await Promise.all([
        tauriInvoke<TenantDto[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' }),
        tauriInvoke<DeviceDto[]>('get_devices', { callerRole: 'MASTER' }),
        tauriInvoke<GlobalUserDto[]>('get_global_users', { callerRole: 'MASTER' }),
      ]);
      setTenants(tenantsData);
      setDevices(devicesData);
      setUsers(usersData);

      // Açık modal pencereleri varsa güncel veriyle tazele
      if (selectedTenantForDetail) {
        const updated = tenantsData.find(t => t.id === selectedTenantForDetail.id);
        if (updated) setSelectedTenantForDetail(updated);
      }
      if (editingTenant) {
        const updatedEdit = tenantsData.find(t => t.id === editingTenant.id);
        if (updatedEdit) setEditingTenant(updatedEdit);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [editingTenant, selectedTenantForDetail]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ID Kopyalama bildirimi (güvenli ve hataya dayanıklı)
  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let copied = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(id);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = id;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const activeCount = tenants.filter(t => t.status?.toUpperCase() === 'ACTIVE').length;
  const suspendedCount = tenants.filter(t => t.status?.toUpperCase() === 'SUSPENDED').length;

  // Filtrelenmiş işletmeler listesi
  const filteredTenants = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tenants.filter(t => {
      const matchesSearch =
        !q ||
        (t.name || '').toLowerCase().includes(q) ||
        (t.id || '').toLowerCase().includes(q) ||
        (t.contact_person && t.contact_person.toLowerCase().includes(q)) ||
        (t.email && t.email.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === 'ALL' || t.status?.toUpperCase() === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [tenants, searchQuery, statusFilter]);

  // Arama veya filtre değiştiğinde ilk sayfaya dön
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredTenants.length / pageSize) || 1;
  const paginatedTenants = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTenants.slice(start, start + pageSize);
  }, [filteredTenants, currentPage, pageSize]);

  return (
    <div className="space-y-6 w-full text-left font-sans">
      {/* Üst Başlık & Aksiyon Butonları */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="text-[10px] font-mono tracking-widest text-white/40 uppercase mb-1">
            İŞLETME VERİTABANI &bull; MULTI-TENANT
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-3">
            <span>İşletme Yönetimi</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/70 border border-white/[0.08] font-normal">
              {tenants.length} Kayıtlı
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-2.5">
          <AppleButton
            variant="secondary"
            size="sm"
            onClick={loadData}
            disabled={loading}
            icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          >
            Yenile
          </AppleButton>
          <AppleButton
            variant="primary"
            size="sm"
            onClick={() => setIsWizardOpen(true)}
            icon={<Plus size={14} />}
          >
            Yeni İşletme Kaydet
          </AppleButton>
        </div>
      </div>

      {/* Mini İstatistik Barı — Apple Cam Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AppleGlassCard variant="regular" className="p-5">
          <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">Toplam Kayıtlı İşletme</p>
          <p className="text-3xl font-semibold text-white mt-1 tracking-tight">{tenants.length}</p>
        </AppleGlassCard>
        <AppleGlassCard variant="regular" className="p-5">
          <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">Aktif İşletmeler</p>
          <p className="text-3xl font-semibold text-emerald-400 mt-1 tracking-tight">{activeCount}</p>
        </AppleGlassCard>
        <AppleGlassCard variant="regular" className="p-5">
          <p className="text-white/50 text-[11px] font-medium uppercase tracking-wider">Askıya Alınanlar (Beklemede)</p>
          <p className="text-3xl font-semibold text-amber-400 mt-1 tracking-tight">{suspendedCount}</p>
        </AppleGlassCard>
      </div>

      {/* Arama & Durum Filtresi — Apple Segmented Control */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="İşletme adı, yetkili, e-posta veya ID ile ara..."
            className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-white/30 focus:ring-2 focus:ring-white/10 pl-11 pr-4 py-2.5 rounded-2xl text-xs text-white placeholder-white/30 outline-none transition-all"
          />
        </div>

        {/* Durum Segmentli Filtreleme */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] p-1 rounded-2xl shrink-0">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white text-black shadow-md font-semibold'
                : 'text-white/60 hover:text-white'
            }`}
          >
            Tümü ({tenants.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('ACTIVE')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'ACTIVE'
                ? 'bg-white text-black shadow-md font-semibold'
                : 'text-white/60 hover:text-white'
            }`}
          >
            Aktif ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('SUSPENDED')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              statusFilter === 'SUSPENDED'
                ? 'bg-white text-black shadow-md font-semibold'
                : 'text-white/60 hover:text-white'
            }`}
          >
            Askıda ({suspendedCount})
          </button>
        </div>
      </div>

      {/* Hata Bildirimi */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-2xl px-5 py-3.5 text-xs flex items-center gap-2.5 backdrop-blur-md">
          <AlertOctagon size={16} className="text-rose-400 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Müşteri Listesi — Apple Cam Kart Izgarası */}
      {loading ? (
        <div className="p-16 text-center text-white/50 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={24} className="animate-spin text-white/70" />
          <span className="text-xs">İşletmeler yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {paginatedTenants.map(t => {
            const tenantDevCount = devices.filter(d => d.tenant_id === t.id).length;
            const tenantUsrCount = users.filter(u => u.tenant_id === t.id && u.id !== 'usr_master' && u.role !== 'MASTER').length;
            const isCopied = copiedId === t.id;
            const isActive = t.status?.toUpperCase() === 'ACTIVE';

            return (
              <AppleGlassCard
                key={t.id}
                isInteractive
                variant="regular"
                onClick={() => setSelectedTenantForDetail(t)}
                className="p-6 flex flex-col justify-between group transition-all duration-200 hover:border-white/20 hover:scale-[1.01]"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="pr-2 overflow-hidden">
                      <h3 className="text-base font-semibold text-white tracking-tight group-hover:text-cyan-400 transition-colors truncate">
                        {t.name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] font-mono text-white/50 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md">
                          {t.id}
                        </span>
                        <button
                          type="button"
                          onClick={e => handleCopy(t.id, e)}
                          className="text-white/40 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
                          title="ID Kopyala"
                        >
                          {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                    <AppBadge variant={isActive ? 'success' : 'warning'}>
                      {isActive ? 'Aktif' : 'Askıda'}
                    </AppBadge>
                  </div>

                  <div className="space-y-2 mt-4 text-xs">
                    <div className="flex justify-between border-b border-white/[0.05] pb-2">
                      <span className="text-white/40">Yetkili:</span>
                      <span className="text-white/90 font-medium">{t.contact_person || '—'}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.05] pb-2">
                      <span className="text-white/40">İletişim:</span>
                      <span className="text-white/70 truncate max-w-[170px]">{t.email || t.phone || '—'}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.05] pb-2">
                      <span className="text-white/40">Kayıt:</span>
                      <span className="text-white/70">{t.created_at ? new Date(t.created_at).toLocaleDateString('tr-TR') : '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-white/70 bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 rounded-xl" title="Terminal Sayısı">
                      <Monitor size={12} className="text-cyan-400" />
                      <span className="font-semibold text-white">{tenantDevCount}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-white/70 bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 rounded-xl" title="Personel Sayısı">
                      <UsersIcon size={12} className="text-purple-400" />
                      <span className="font-semibold text-white">{tenantUsrCount}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setEditingTenant(t)}
                      className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                      title="İşletme Bilgilerini Düzenle"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const ownerStaff = users.find(u => u.tenant_id === t.id && u.role === 'OWNER') || {
                          id: `usr_owner_${t.id}`,
                          name: `${t.name} Yetkilisi`,
                          role: 'OWNER',
                          tenant_id: t.id,
                        };
                        setVaultUser(ownerStaff);
                      }}
                      className="w-8 h-8 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-300 flex items-center justify-center transition-all cursor-pointer"
                      title="Giriş Şifresi & PIN (Güvenlik Kasası)"
                    >
                      <Key size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTenantForDetail(t)}
                      className="w-8 h-8 rounded-xl bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] text-white flex items-center justify-center transition-all cursor-pointer"
                      title="Detaylı Yönetim"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              </AppleGlassCard>
            );
          })}

          {filteredTenants.length === 0 && (
            <div className="col-span-full p-16 text-center text-white/40 bg-white/[0.02] rounded-3xl border border-white/[0.06]">
              <Building2 size={32} className="mx-auto mb-3 text-white/20" />
              {searchQuery || statusFilter !== 'ALL'
                ? 'Filtreleme kriterlerine uygun işletme bulunamadı.'
                : 'Henüz kayıtlı işletme bulunmamaktadır.'}
            </div>
          )}
        </div>
      )}

      {/* Sayfalama (Pagination) */}
      {totalPages > 1 && !loading && (
        <div className="p-4 border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl flex items-center justify-between text-xs text-white/60 mt-4 rounded-2xl">
          <div>
            Toplam <strong>{filteredTenants.length}</strong> işletme içerisinden{' '}
            <strong>{(currentPage - 1) * pageSize + 1}</strong> -{' '}
            <strong>{Math.min(currentPage * pageSize, filteredTenants.length)}</strong> arası gösteriliyor.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1 transition-all cursor-pointer"
            >
              <ChevronLeft size={13} />
              <span>Önceki</span>
            </button>
            <span className="px-2 font-medium text-white">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1 transition-all cursor-pointer"
            >
              <span>Sonraki</span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* APPLE SETUP ASSISTANT STANDARTLARINDA KURULUM SİHİRBAZI */}
      <PlatformSetupWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onSuccess={loadData}
      />

      {/* İŞLETME BİLGİSİ DÜZENLEME MODALI */}
      <EditTenantModal
        isOpen={!!editingTenant}
        tenant={editingTenant}
        onClose={() => setEditingTenant(null)}
        onSuccess={loadData}
      />

      {/* MÜŞTERİ DETAY VE CİHAZ YÖNETİM MODALI */}
      {selectedTenantForDetail && (
        <TenantDetailModal
          tenant={selectedTenantForDetail}
          devices={devices}
          users={users}
          isOpen={!!selectedTenantForDetail}
          onClose={() => setSelectedTenantForDetail(null)}
          onRefresh={loadData}
        />
      )}

      {/* GÜVENLİK KASASI (MASTER VAULT) MODALI */}
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
