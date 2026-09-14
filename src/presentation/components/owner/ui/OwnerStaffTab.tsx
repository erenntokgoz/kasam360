import { useEffect, useState, useMemo } from 'react';
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
  CheckCircle2,
  KeyRound,
  Shield,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
};

const ROLE_INFO: Record<string, { label: string; bg: string; text: string; desc: string }> = {
  MANAGER: {
    label: 'Yönetici / Manager',
    bg: 'bg-blue-950/80 border-blue-800',
    text: 'text-blue-400',
    desc: 'Kasa açma/kapama, onaylar, ikram ve iptal yetkisi',
  },
  CASHIER: {
    label: 'Kasiyer / Cashier',
    bg: 'bg-emerald-950/80 border-emerald-800',
    text: 'text-emerald-400',
    desc: 'Ödeme alma, vardiya yönetimi, fiş kesme',
  },
  WAITER: {
    label: 'Garson / Waiter',
    bg: 'bg-amber-950/80 border-amber-800',
    text: 'text-amber-400',
    desc: 'Masa yönetimi, sipariş oluşturma ve servis takibi',
  },
  KITCHEN: {
    label: 'Mutfak / Kitchen',
    bg: 'bg-orange-950/80 border-orange-800',
    text: 'text-orange-400',
    desc: 'KDS ekranı ve sipariş hazırlık istasyonları',
  },
  OWNER: {
    label: 'Patron / Owner',
    bg: 'bg-indigo-950/80 border-indigo-800',
    text: 'text-indigo-400',
    desc: 'Tam sistem ve şube yönetim yetkisi',
  },
};

export function OwnerStaffTab() {
  const user = useAuthStore(s => s.user);
  const actorRole = user?.role || 'OWNER';
  const tenantId = user?.tenantId || 'DEFAULT_TENANT';

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Role Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingStaff, setViewingStaff] = useState<StaffMember | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffMember | null>(null);

  // Form State
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

  const fetchStaff = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await invoke<StaffMember[]>('get_staff', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
      }).catch(err => {
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
  };

  useEffect(() => {
    fetchStaff();
  }, [actorRole, tenantId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPin.trim()) {
      setError('Ad Soyad ve PIN alanları zorunludur.');
      return;
    }
    if (formPin.length < 4 || formPin.length > 6) {
      setError('PIN kodu 4 ila 6 haneli olmalıdır.');
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

      setSuccessMessage(`"${formName}" personeli başarıyla oluşturuldu.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      // Reset
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

      setSuccessMessage(`"${deletingStaff.name}" personeli sistemden silindi.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setDeletingStaff(null);
      setViewingStaff(null);
      await fetchStaff(true);
    } catch (e) {
      console.error('Delete staff error:', e);
      setError(typeof e === 'string' ? e : 'Personel silinirken hata meydana geldi.');
    }
  };

  const filteredStaff = useMemo(() => {
    return staff.filter(s => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || s.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [staff, searchTerm, roleFilter]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="text-indigo-400" />
            Personel & Kullanıcı Yönetimi
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Şubenizde görev yapan personelleri listeleyin, yeni kullanıcı yetkilendirin ve PIN kodlarını yönetin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchStaff(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl text-slate-300 hover:text-white transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Yenile</span>
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors text-sm shadow-lg shadow-indigo-600/20"
          >
            <UserPlus size={18} />
            <span>Yeni Personel Ekle</span>
          </button>
        </div>
      </div>

      {/* Alert Banners */}
      {error && (
        <div className="bg-red-950/40 border border-red-800 text-red-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X size={16} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-200">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Personel adı veya rol ara..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'].map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${
                roleFilter === r
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
              }`}
            >
              {r === 'ALL' ? 'Tümü' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Staff Grid */}
      {loading ? (
        <div className="flex h-48 items-center justify-center text-slate-400 gap-3">
          <RefreshCw size={24} className="animate-spin text-indigo-500" />
          <span>Personel listesi yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredStaff.map(member => {
            const roleMeta = ROLE_INFO[member.role] || {
              label: member.role,
              bg: 'bg-slate-800 border-slate-700',
              text: 'text-slate-300',
              desc: 'Personel',
            };

            return (
              <div
                key={member.id}
                onClick={() => setViewingStaff(member)}
                className="group bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-xl hover:shadow-black/40 cursor-pointer"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-base">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-base group-hover:text-indigo-400 transition-colors">
                          {member.name}
                        </h3>
                        <span className="text-xs font-mono text-slate-500">ID: {member.id.slice(0, 8)}...</span>
                      </div>
                    </div>

                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-bold border ${roleMeta.bg} ${roleMeta.text}`}
                    >
                      {member.role}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800/60 mt-2">
                    {roleMeta.desc}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Shield size={13} className="text-slate-400" />
                    {roleMeta.label}
                  </span>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setViewingStaff(member)}
                      className="text-indigo-400 hover:underline font-medium"
                    >
                      Yönet
                    </button>
                    <button
                      onClick={() => setDeletingStaff(member)}
                      className="p-1 rounded text-red-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                      title="Personeli Sil"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredStaff.length === 0 && (
            <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
              <Users size={40} className="mx-auto text-slate-600 mb-3" />
              <p className="text-slate-400 font-medium text-base">
                {searchTerm ? `"${searchTerm}" arama kriterine uygun personel bulunamadı.` : 'Henüz kayıtlı personel yok.'}
              </p>
              <button
                onClick={handleOpenAddModal}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Yeni Personel Ekle
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <UserPlus className="text-indigo-400" size={22} />
                <h3 className="font-bold text-lg text-white">Yeni Personel Tanımla</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Ad Soyad <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Mehmet Kaya"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Görevi / Rolü
                </label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 text-sm"
                >
                  <option value="MANAGER">Manager (Şube Yöneticisi)</option>
                  <option value="CASHIER">Cashier (Kasa & Vardiya)</option>
                  <option value="WAITER">Waiter (Garson & Masa)</option>
                  <option value="KITCHEN">Kitchen (Mutfak KDS)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  {ROLE_INFO[formRole]?.desc}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Giriş PIN Kodu (4-6 Haneli) <span className="text-red-400">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPin}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium transition-colors"
                  >
                    <Sparkles size={13} />
                    <span>Rastgele PIN Üret</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPinText ? 'text' : 'password'}
                    required
                    maxLength={6}
                    placeholder="1234"
                    value={formPin}
                    onChange={e => setFormPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-base focus:outline-none focus:border-indigo-500 tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPinText(!showPinText)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPinText ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Otomatik 4 haneli PIN üretildi. Dilerseniz değiştirebilirsiniz.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm shadow-lg shadow-indigo-600/20"
                >
                  {isSaving ? 'Kaydediliyor...' : 'Personeli Kaydet'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Details Modal */}
      {viewingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  {viewingStaff.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">{viewingStaff.name}</h3>
                  <span className="text-xs text-slate-400">Personel Kartı</span>
                </div>
              </div>
              <button
                onClick={() => setViewingStaff(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kullanıcı ID:</span>
                <span className="font-mono text-indigo-300 text-xs">{viewingStaff.id}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Rol & Yetki:</span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                    ROLE_INFO[viewingStaff.role]?.bg
                  } ${ROLE_INFO[viewingStaff.role]?.text}`}
                >
                  {viewingStaff.role}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Kiracı (Tenant):</span>
                <span className="font-mono text-slate-300 text-xs">{viewingStaff.tenant_id}</span>
              </div>
              <div className="py-1">
                <span className="text-slate-400 block mb-1">Yetki Kapsamı:</span>
                <p className="text-slate-300 text-xs bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  {ROLE_INFO[viewingStaff.role]?.desc}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeletingStaff(viewingStaff);
                }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                <span>Personeli Sil</span>
              </button>
              <button
                onClick={() => setViewingStaff(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Staff Modal (Replaces window.confirm) */}
      {deletingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-500/10 text-red-400 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-white">
                  "{deletingStaff.name}" Personelini Sil
                </h3>
                <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                  Bu personeli sistemden silmek istediğinize emin misiniz? Bu kullanıcı artık POS veya yönetim paneline giriş yapamayacaktır.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-red-600/20"
              >
                Evet, Kalıcı Olarak Sil
              </button>
              <button
                onClick={() => setDeletingStaff(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-sm"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
