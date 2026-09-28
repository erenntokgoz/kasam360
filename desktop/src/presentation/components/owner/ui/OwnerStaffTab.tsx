import { useEffect, useState, useMemo, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import {
  Users,
  UserPlus,
  Trash2,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  KeyRound,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast as useToast } from '@core/components/ui/toast';

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
};

const ROLE_INFO: Record<string, { label: string; badge: string; desc: string }> = {
  MANAGER: {
    label: 'Yönetici / Manager',
    badge: 'bg-blue-500/15 text-blue-500 dark:text-blue-400 border-blue-500/30',
    desc: 'Kasa açma/kapama, onaylar, ikram ve iptal yetkisi',
  },
  CASHIER: {
    label: 'Kasiyer / Cashier',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    desc: 'Ödeme alma, vardiya yönetimi, fiş kesme',
  },
  WAITER: {
    label: 'Garson / Waiter',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    desc: 'Masa yönetimi, sipariş oluşturma ve servis takibi',
  },
  KITCHEN: {
    label: 'Mutfak / Kitchen',
    badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    desc: 'KDS ekranı ve sipariş hazırlık istasyonları',
  },
  OWNER: {
    label: 'Patron / Owner',
    badge: 'bg-indigo-500/15 text-[#007AFF] border-indigo-500/30',
    desc: 'Tam sistem, şube ve finansal yönetim yetkisi',
  },
};

// Patron Paneli: Personel & Kullanıcı Yönetimi (Renksiz Frosted Glass)
export function OwnerStaffTab() {
  const user = useAuthStore((s) => s.user);
  const actorRole = user?.role || 'OWNER';
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';
  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arama & Rol Filtresi
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Modallar
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingStaff, setViewingStaff] = useState<StaffMember | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffMember | null>(null);

  // Form Durumu
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('WAITER');
  const [formPin, setFormPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const generateRandomPin = () => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setFormPin(newPin);
    setShowPinText(true);
  };

  const handleOpenAddModal = () => {
    setError(null);
    setFormName('');
    setFormRole('WAITER');
    generateRandomPin();
    setShowAddModal(true);
  };

  const fetchStaff = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await invoke<StaffMember[]>('get_staff', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
      }).catch((err) => {
        console.warn('[OwnerStaffTab] get_staff fallback:', err);
        return [];
      });

      setStaff(data || []);
    } catch (e) {
      console.error('Fetch staff error:', e);
      setError(typeof e === 'string' ? e : 'Personel listesi alınamadı.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [actorRole, tenantId]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPin.trim()) {
      setError('Ad Soyad ve PIN alanları zorunludur.');
      return;
    }
    if (formPin.length < 4 || formPin.length > 8) {
      setError('PIN kodu 4 ila 8 haneli olmalıdır.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await invoke('create_staff_member', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        name: formName.trim(),
        role: formRole,
        pin: formPin.trim(),
      });

      addToast(`"${formName}" personeli başarıyla oluşturuldu.`, 'success');

      setFormName('');
      setFormRole('WAITER');
      setFormPin('');
      setShowAddModal(false);

      await fetchStaff(true);
    } catch (e) {
      console.error('Create staff error:', e);
      setError(typeof e === 'string' ? e : 'Personel oluşturulurken hata meydana geldi.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingStaff) return;

    try {
      await invoke('delete_staff_member', {
        actorRole,
        actor_role: actorRole,
        staffId: deletingStaff.id,
        staff_id: deletingStaff.id,
      });

      addToast(`"${deletingStaff.name}" personeli sistemden silindi.`, 'success');
      setDeletingStaff(null);
      setViewingStaff(null);
      await fetchStaff(true);
    } catch (e) {
      console.error('Delete staff error:', e);
      setError(typeof e === 'string' ? e : 'Personel silinirken hata meydana geldi.');
    }
  };

  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || s.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [staff, searchTerm, roleFilter]);

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12 select-none text-zinc-900 dark:text-zinc-100">
      {/* Üst Başlık & Eylemler — Bağımsız Yüzen Cam Ada */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <Users className="text-[#007AFF]" size={22} />
            <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">
              Personel & Yetki Yönetimi
            </h2>
          </div>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            Şube personellerinin PIN kodları, görev rolleri ve erişim yetkilerinin kontrolü.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchStaff(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 rounded-2xl text-xs font-medium dark:text-white text-zinc-900 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-zinc-400' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer active:scale-95"
          >
            <UserPlus size={15} />
            <span>Yeni Personel</span>
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

      {/* Arama ve Rol Filtreleme Barı */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Personel adı veya rol ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] rounded-2xl text-xs dark:text-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-[#007AFF] transition-all backdrop-blur-md"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1.5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-md border dark:border-white/10 border-black/[0.08] shadow-sm overflow-x-auto pb-1 sm:pb-1.5 no-scrollbar">
          {['ALL', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'].map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3.5 py-1.5 rounded-2xl text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                roleFilter === r
                  ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm border dark:border-white/10 border-black/[0.08]'
                  : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 dark:bg-white/[0.03] bg-black/[0.03]'
              }`}
            >
              {r === 'ALL' ? 'Tümü' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Personel Kartları Izgarası (Renksiz Frosted Glass) */}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-xs dark:text-zinc-400 text-zinc-500 gap-2">
          <RefreshCw size={16} className="animate-spin text-[#007AFF]" />
          <span>Personel listesi yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStaff.map((member) => {
            const roleMeta = ROLE_INFO[member.role] || {
              label: member.role,
              badge: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
              desc: 'Personel',
            };

            return (
              <div
                key={member.id}
                onClick={() => setViewingStaff(member)}
                className="group dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 flex flex-col justify-between backdrop-blur-xl transition-all shadow-lg hover:shadow-xl cursor-pointer"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] text-[#007AFF] flex items-center justify-center font-bold text-base shadow-inner">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold dark:text-white text-zinc-900 text-sm group-hover:text-[#007AFF] transition-colors">
                          {member.name}
                        </h3>
                        <span className="text-[11px] font-mono dark:text-zinc-400 text-zinc-500">
                          ID: {member.id.slice(0, 10)}
                        </span>
                      </div>
                    </div>

                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${roleMeta.badge}`}>
                      {member.role}
                    </span>
                  </div>

                  <p className="text-xs dark:text-zinc-400 text-zinc-600 dark:bg-black/20 bg-black/[0.03] p-2.5 rounded-xl border dark:border-white/5 border-black/5 mt-2">
                    {roleMeta.desc}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t dark:border-white/5 border-black/5 flex items-center justify-between text-xs dark:text-zinc-400 text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Shield size={12} className="text-zinc-400" />
                    {roleMeta.label}
                  </span>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setViewingStaff(member)}
                      className="text-[#007AFF] hover:underline font-semibold"
                    >
                      Yönet
                    </button>
                    <button
                      onClick={() => setDeletingStaff(member)}
                      className="p-1 rounded text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="Personeli Sil"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredStaff.length === 0 && (
            <div className="col-span-full py-16 text-center border border-dashed dark:border-white/10 border-black/10 rounded-3xl dark:bg-white/[0.02] bg-white/40">
              <Users size={36} className="mx-auto text-zinc-400 mb-2 opacity-40" />
              <p className="dark:text-zinc-400 text-zinc-600 text-sm font-medium">
                {searchTerm
                  ? `"${searchTerm}" arama kriterine uygun personel bulunamadı.`
                  : 'Henüz kayıtlı personel bulunmuyor.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* iOS Modal: Yeni Personel Ekle */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="text-[#007AFF]" size={20} />
                <h3 className="font-bold text-base dark:text-white text-zinc-900">Yeni Personel Tanımla</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Ad Soyad *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Ayşe Yılmaz"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl px-3.5 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider mb-1">
                  Görevi / Rolü
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full dark:bg-[#2c2c2e] bg-white border dark:border-white/10 border-black/[0.08] rounded-xl px-3 py-2 text-xs dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                >
                  <option value="MANAGER">Manager (Şube Yöneticisi)</option>
                  <option value="CASHIER">Cashier (Kasa & Vardiya)</option>
                  <option value="WAITER">Waiter (Garson & Masa)</option>
                  <option value="KITCHEN">Kitchen (Mutfak KDS)</option>
                </select>
                <p className="text-[11px] dark:text-zinc-400 text-zinc-500 mt-1">
                  {ROLE_INFO[formRole]?.desc}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">
                    Giriş PIN Kodu (4-8 Haneli) *
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPin}
                    className="text-xs text-[#007AFF] hover:underline flex items-center gap-1 font-medium transition-colors"
                  >
                    <RefreshCw size={12} />
                    <span>Rastgele PIN</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type={showPinText ? 'text' : 'password'}
                    required
                    maxLength={8}
                    placeholder="1234"
                    value={formPin}
                    onChange={(e) => setFormPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full pl-9 pr-9 py-2 dark:bg-white/[0.04] bg-white/70 border dark:border-white/10 border-black/[0.08] rounded-xl font-mono text-base tracking-wider dark:text-white text-zinc-900 focus:outline-none focus:border-[#007AFF]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPinText(!showPinText)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    {showPinText ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 bg-white hover:bg-zinc-200 text-black font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Modal: Personel Detay */}
      {viewingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center font-bold">
                  {viewingStaff.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-base dark:text-white text-zinc-900">{viewingStaff.name}</h3>
                  <span className="text-[11px] dark:text-zinc-400 text-zinc-500">Personel Kartı</span>
                </div>
              </div>
              <button
                onClick={() => setViewingStaff(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="dark:bg-white/[0.03] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/5 border-black/5 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">Kullanıcı ID</span>
                <span className="font-mono text-[#007AFF]">{viewingStaff.id}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b dark:border-white/5 border-black/5">
                <span className="dark:text-zinc-400 text-zinc-500">Rol & Yetki</span>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${ROLE_INFO[viewingStaff.role]?.badge}`}>
                  {viewingStaff.role}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="dark:text-zinc-400 text-zinc-500">Kiracı</span>
                <span className="font-mono dark:text-zinc-300 text-zinc-700">{viewingStaff.tenant_id}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDeletingStaff(viewingStaff);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Trash2 size={13} />
                <span>Personeli Sil</span>
              </button>
              <button
                onClick={() => setViewingStaff(null)}
                className="px-4 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Modal: Silme Onayı */}
      {deletingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-150">
          <div className="dark:bg-[#1c1c1e]/90 bg-white/90 border border-rose-500/30 rounded-3xl max-w-sm w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-500/15 text-rose-500 rounded-xl">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base dark:text-white text-zinc-900">
                  "{deletingStaff.name}" Personelini Sil
                </h3>
                <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
                  Bu personeli sistemden silmek istediğinize emin misiniz? Bu kullanıcı artık sisteme giriş yapamayacaktır.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeletingStaff(null)}
                className="flex-1 py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/10 hover:bg-black/10 dark:text-zinc-300 text-zinc-700 font-medium rounded-xl text-xs transition-colors"
              >
                Vazgeç
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs shadow-sm transition-all cursor-pointer"
              >
                Evet, Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
