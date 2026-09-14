import React, { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../../store/useAuthStore';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  Users, 
  UserPlus, 
  Clock, 
  Trash2, 
  Search, 
  RefreshCw, 
  ShieldCheck, 
  Lock, 
  X,
  ChefHat,
  BadgePercent
} from 'lucide-react';

import { ConfirmationModal } from './ConfirmationModal';

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  tenant_id: string;
}

export interface OpenShift {
  id: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  openingBalance: number;
}

function timeSince(dateStr?: string): string {
  if (!dateStr) return '-';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  return `${hours} sa ${mins % 60} dk`;
}

export function StaffManagementPanel() {
  const user = useAuthStore(s => s.user);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Yeni Personel Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('WAITER');
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Silme Onay Modal State
  const [staffToDelete, setStaffToDelete] = useState<StaffMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Personel Detay Modal State
  const [selectedStaffDetail, setSelectedStaffDetail] = useState<StaffMember | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchData = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const [staffData, shiftsData] = await Promise.all([
        invoke<StaffMember[]>('get_staff', { 
          actorRole: user?.role || 'MANAGER',
          tenantId: user?.tenantId || 'DEFAULT_TENANT'
        }),
        invoke<OpenShift[]>('get_open_shifts', { 
          actorRole: user?.role || 'MANAGER' 
        }),
      ]);
      setStaff(staffData || []);
      setOpenShifts(shiftsData || []);
    } catch (error) {
      console.error('Failed to load staff data:', error);
      addToast('Personel ve vardiya bilgileri alınamadı.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.role, user?.tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      addToast('Personel adı gereklidir.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      addToast('PIN kodu tam olarak 4 haneli rakamlardan oluşmalıdır.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await invoke('create_staff_member', {
        actorRole: user?.role || 'MANAGER',
        tenantId: user?.tenantId || 'DEFAULT_TENANT',
        name: name.trim(),
        role: role.toUpperCase(),
        pin: pin,
      });

      addToast(`${name} başarıyla personel olarak eklendi.`, 'success');
      setIsAddModalOpen(false);
      setName('');
      setRole('WAITER');
      setPin('');
      await fetchData(false);
    } catch (error) {
      console.error('Failed to create staff member:', error);
      addToast(`Personel eklenemedi: ${error}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!staffToDelete) return;

    setIsDeleting(true);
    try {
      await invoke('delete_staff_member', {
        actorRole: user?.role || 'MANAGER',
        staffId: staffToDelete.id,
      });

      addToast(`${staffToDelete.name} başarıyla silindi.`, 'success');
      setStaffToDelete(null);
      await fetchData(false);
    } catch (error) {
      console.error('Failed to delete staff member:', error);
      addToast(`Personel silinemedi: ${error}`, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const roleBadge = (r: string) => {
    switch (r.toUpperCase()) {
      case 'MASTER':
      case 'OWNER':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'MANAGER':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
      case 'CASHIER':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'WAITER':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'KITCHEN':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-slate-700/40 text-slate-300 border-slate-600';
    }
  };

  const filteredStaff = staff.filter(s => {
    const matchesRole = roleFilter === 'ALL' || s.role.toUpperCase() === roleFilter;
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRole && matchesSearch;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Üst KPI Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Toplam Personel</span>
            <p className="text-3xl font-bold text-white mt-1">{staff.length}</p>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Users size={24} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Açık Vardiyalar</span>
            <p className="text-3xl font-bold text-emerald-400 mt-1">{openShifts.length}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <Clock size={24} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Garson Kadrosu</span>
            <p className="text-3xl font-bold text-blue-400 mt-1">
              {staff.filter(s => s.role.toUpperCase() === 'WAITER').length}
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
            <BadgePercent size={24} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mutfak Kadrosu</span>
            <p className="text-3xl font-bold text-amber-400 mt-1">
              {staff.filter(s => s.role.toUpperCase() === 'KITCHEN').length}
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <ChefHat size={24} />
          </div>
        </div>
      </div>

      {/* Açık Vardiyalar Bölümü */}
      {openShifts.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Aktif Açık Vardiyalar</h3>
            </div>
            <span className="text-xs text-slate-400">{openShifts.length} aktif kasa açık</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {openShifts.map(shift => (
              <div key={shift.id} className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <h5 className="font-semibold text-white text-sm">{shift.cashierName || shift.cashierId}</h5>
                  <p className="text-xs text-slate-400 mt-0.5">Başlangıç: {timeSince(shift.openedAt)}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500">Açılış Kasası</span>
                  <div className="mt-0.5">
                    <MoneyDisplay amountInCents={shift.openingBalance} className="text-emerald-400 text-sm font-bold" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personel Kadrosu Başlık & Filtreler */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRoleFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roleFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Tümü ({staff.length})
          </button>
          <button
            onClick={() => setRoleFilter('MANAGER')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roleFilter === 'MANAGER' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Müdürler
          </button>
          <button
            onClick={() => setRoleFilter('CASHIER')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roleFilter === 'CASHIER' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Kasiyerler
          </button>
          <button
            onClick={() => setRoleFilter('WAITER')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roleFilter === 'WAITER' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Garsonlar
          </button>
          <button
            onClick={() => setRoleFilter('KITCHEN')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              roleFilter === 'KITCHEN' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            Mutfak
          </button>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Personel adı ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold shadow transition-colors"
          >
            <UserPlus size={16} />
            Personel Ekle
          </button>
        </div>
      </div>

      {/* Personel Listesi Tablosu */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900">
        {filteredStaff.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            Personel kaydı bulunamadı.
          </div>
        ) : (
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Personel Adı</th>
                <th className="px-6 py-4">Rol / Yetki Seviyesi</th>
                <th className="px-6 py-4">Kullanıcı Kimliği (ID)</th>
                <th className="px-6 py-4">Giriş Türü</th>
                <th className="px-6 py-4 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredStaff.map(member => {
                const isCurrentUser = member.id === user?.userId;

                return (
                  <tr 
                    key={member.id} 
                    onClick={() => setSelectedStaffDetail(member)}
                    className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white flex items-center gap-2">
                        {member.name}
                        {isCurrentUser && (
                          <span className="text-[10px] bg-slate-800 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded">
                            Siz
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${roleBadge(member.role)}`}>
                        {member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">{member.id}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs flex items-center gap-1.5">
                      <Lock size={12} className="text-slate-500" />
                      4 Haneli Hızlı PIN
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setStaffToDelete(member)}
                        disabled={isCurrentUser}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        title={isCurrentUser ? "Kendinizi silemezsiniz" : "Personeli Sil"}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL 1: Yeni Personel Ekle */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-indigo-400" size={20} />
                <h3 className="text-lg font-bold text-white">Yeni Personel Tanımla</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Hasan Yılmaz"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Görevi / Rolü *</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="WAITER">Garson (WAITER)</option>
                  <option value="CASHIER">Kasiyer (CASHIER)</option>
                  <option value="KITCHEN">Mutfak / Aşçı (KITCHEN)</option>
                  <option value="MANAGER">Şube Müdürü (MANAGER)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  4 Haneli Giriş PIN Kodu *
                </label>
                <input
                  type="password"
                  maxLength={4}
                  required
                  placeholder="****"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono tracking-widest text-center text-lg focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Personelin terminal ve el terminallerine giriş yapacağı 4 haneli sayısal şifre.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Ekleniyor...' : 'Personeli Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Personel Detay Modalı */}
      {selectedStaffDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="text-indigo-400" size={20} />
                <h3 className="text-base font-bold text-white">Personel Kartı</h3>
              </div>
              <button
                onClick={() => setSelectedStaffDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Ad Soyad:</span>
                <span className="font-bold text-white text-sm">{selectedStaffDetail.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Rol & Yetki:</span>
                <span className={`px-2.5 py-0.5 rounded-full font-semibold border ${roleBadge(selectedStaffDetail.role)}`}>
                  {selectedStaffDetail.role}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Kullanıcı Kimliği:</span>
                <span className="font-mono text-slate-300">{selectedStaffDetail.id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Kiracı / Şube:</span>
                <span className="text-slate-300">{selectedStaffDetail.tenant_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Giriş Doğrulama:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <Lock size={12} /> Aktif PIN Doğrulaması
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              {selectedStaffDetail.id !== user?.userId && (
                <button
                  onClick={() => {
                    const member = selectedStaffDetail;
                    setSelectedStaffDetail(null);
                    setStaffToDelete(member);
                  }}
                  className="px-4 py-2 bg-red-950/40 hover:bg-red-900/60 border border-red-700/50 text-red-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Personeli Sil
                </button>
              )}
              <button
                onClick={() => setSelectedStaffDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Silme Onay Modalı */}
      <ConfirmationModal
        isOpen={Boolean(staffToDelete)}
        onClose={() => setStaffToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Personeli Sil"
        description={`${staffToDelete?.name} (${staffToDelete?.role}) adlı personeli sistemden kalıcı olarak silmek istediğinize emin misiniz?`}
        confirmText="Evet, Sil"
        cancelText="Vazgeç"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
