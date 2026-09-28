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
    if (!/^\d{4,8}$/.test(pin)) {
      addToast('PIN kodu 4 ila 8 haneli rakamlardan oluşmalıdır.', 'error');
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
        return 'bg-[#007AFF]/20 text-[#5AC8FA] border-[#007AFF]/50/40';
      case 'CASHIER':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'WAITER':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'KITCHEN':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'dark:bg-white/[0.08] bg-black/[0.05] dark:text-zinc-300 text-zinc-700 dark:border-white/10 border-black/10';
    }
  };

  const filteredStaff = staff.filter(s => {
    const matchesRole = roleFilter === 'ALL' || s.role.toUpperCase() === roleFilter;
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRole && matchesSearch;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-zinc-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-foreground">
      {/* Üst KPI Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">Toplam Personel</span>
            <p className="text-3xl font-bold dark:text-white text-zinc-900 mt-1">{staff.length}</p>
          </div>
          <div className="p-3 bg-[#007AFF]/10 text-[#007AFF] rounded-2xl">
            <Users size={24} />
          </div>
        </div>

        <div className="rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">Açık Vardiyalar</span>
            <p className="text-3xl font-bold text-emerald-400 mt-1">{openShifts.length}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl">
            <Clock size={24} />
          </div>
        </div>

        <div className="rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">Garson Kadrosu</span>
            <p className="text-3xl font-bold text-blue-400 mt-1">
              {staff.filter(s => s.role.toUpperCase() === 'WAITER').length}
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl">
            <BadgePercent size={24} />
          </div>
        </div>

        <div className="rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">Mutfak Kadrosu</span>
            <p className="text-3xl font-bold text-amber-400 mt-1">
              {staff.filter(s => s.role.toUpperCase() === 'KITCHEN').length}
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl">
            <ChefHat size={24} />
          </div>
        </div>
      </div>

      {/* Açık Vardiyalar Bölümü */}
      {openShifts.length > 0 && (
        <div className="rounded-3xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-sm font-bold dark:text-white text-zinc-900 uppercase tracking-wider">Aktif Açık Vardiyalar</h3>
            </div>
            <span className="text-xs dark:text-zinc-400 text-zinc-500">{openShifts.length} aktif kasa açık</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {openShifts.map(shift => (
              <div key={shift.id} className="rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] p-3 flex items-center justify-between">
                <div>
                  <h5 className="font-semibold dark:text-white text-zinc-900 text-sm">{shift.cashierName || shift.cashierId}</h5>
                  <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">Başlangıç: {timeSince(shift.openedAt)}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-zinc-500">Açılış Kasası</span>
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
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRoleFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              roleFilter === 'ALL' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Tümü ({staff.length})
          </button>
          <button
            onClick={() => setRoleFilter('MANAGER')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              roleFilter === 'MANAGER' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Müdürler
          </button>
          <button
            onClick={() => setRoleFilter('CASHIER')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              roleFilter === 'CASHIER' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Kasiyerler
          </button>
          <button
            onClick={() => setRoleFilter('WAITER')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              roleFilter === 'WAITER' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Garsonlar
          </button>
          <button
            onClick={() => setRoleFilter('KITCHEN')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              roleFilter === 'KITCHEN' ? 'bg-[#007AFF] text-white shadow-sm' : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Mutfak
          </button>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Personel adı ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] text-sm dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF]/50"
            />
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] dark:text-zinc-300 text-zinc-700 hover:dark:bg-white/[0.1] hover:bg-black/[0.08] transition-all disabled:opacity-50 cursor-pointer"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-sm font-semibold shadow-md shadow-[#007AFF]/25 transition-all cursor-pointer"
          >
            <UserPlus size={16} />
            Personel Ekle
          </button>
        </div>
      </div>

      {/* Personel Listesi Tablosu */}
      <div className="flex-1 overflow-auto rounded-3xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.03] bg-white/80 backdrop-blur-xl shadow-sm">
        {filteredStaff.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            Personel kaydı bulunamadı.
          </div>
        ) : (
          <table className="w-full text-left text-sm dark:text-zinc-300 text-zinc-700">
            <thead className="sticky top-0 dark:bg-[#121318]/90 bg-white/95 backdrop-blur-md text-xs uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
              <tr>
                <th className="px-6 py-4">Personel Adı</th>
                <th className="px-6 py-4">Rol / Yetki Seviyesi</th>
                <th className="px-6 py-4">Kullanıcı Kimliği (ID)</th>
                <th className="px-6 py-4">Giriş Türü</th>
                <th className="px-6 py-4 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-white/[0.06] divide-black/[0.06]">
              {filteredStaff.map(member => {
                const isCurrentUser = member.id === user?.userId;

                return (
                  <tr 
                    key={member.id} 
                    onClick={() => setSelectedStaffDetail(member)}
                    className="hover:dark:bg-white/[0.04] hover:bg-black/[0.02] cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold dark:text-white text-zinc-900 flex items-center gap-2">
                        {member.name}
                        {isCurrentUser && (
                          <span className="text-[10px] dark:bg-white/10 bg-black/[0.05] text-[#007AFF] border border-[#007AFF]/30 px-2 py-0.5 rounded-full font-medium">
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
                    <td className="px-6 py-4 font-mono text-xs dark:text-zinc-400 text-zinc-500">{member.id}</td>
                    <td className="px-6 py-4 dark:text-zinc-400 text-zinc-500 text-xs flex items-center gap-1.5">
                      <Lock size={12} className="text-zinc-400" />
                      4-8 Haneli Hızlı PIN
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setStaffToDelete(member)}
                        disabled={isCurrentUser}
                        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4">
          <div className="w-full max-w-md backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-[#007AFF]" size={20} />
                <h3 className="text-lg font-bold dark:text-white text-zinc-900">Yeni Personel Tanımla</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-full text-zinc-400 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Hasan Yılmaz"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 text-sm focus:outline-none focus:border-[#007AFF]/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1">Görevi / Rolü *</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 text-sm focus:outline-none focus:border-[#007AFF]/50"
                >
                  <option value="WAITER" className="dark:bg-[#121318] bg-white">Garson (WAITER)</option>
                  <option value="CASHIER" className="dark:bg-[#121318] bg-white">Kasiyer (CASHIER)</option>
                  <option value="KITCHEN" className="dark:bg-[#121318] bg-white">Mutfak / Aşçı (KITCHEN)</option>
                  <option value="MANAGER" className="dark:bg-[#121318] bg-white">Şube Müdürü (MANAGER)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1">
                  Giriş PIN Kodu (4-8 Haneli) *
                </label>
                <input
                  type="password"
                  maxLength={8}
                  required
                  placeholder="****"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 text-sm font-mono tracking-widest text-center text-lg focus:outline-none focus:border-[#007AFF]/50"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Personelin terminal ve el terminallerine giriş yapacağı 4-8 haneli sayısal şifre.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t dark:border-white/10 border-black/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-2xl text-sm font-semibold dark:text-zinc-300 text-zinc-700 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] transition-all cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-2xl text-sm font-semibold bg-[#007AFF] hover:bg-[#0071eb] text-white shadow-md shadow-[#007AFF]/25 transition-all disabled:opacity-50 cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4">
          <div className="w-full max-w-md backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="text-[#007AFF]" size={20} />
                <h3 className="text-base font-bold dark:text-white text-zinc-900">Personel Kartı</h3>
              </div>
              <button
                onClick={() => setSelectedStaffDetail(null)}
                className="p-1.5 rounded-full text-zinc-400 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 rounded-2xl dark:bg-white/[0.04] bg-white border dark:border-white/10 border-black/[0.08] space-y-3 text-xs shadow-sm">
              <div className="flex justify-between items-center">
                <span className="dark:text-zinc-400 text-zinc-500">Ad Soyad:</span>
                <span className="font-bold dark:text-white text-zinc-900 text-sm">{selectedStaffDetail.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="dark:text-zinc-400 text-zinc-500">Rol & Yetki:</span>
                <span className={`px-2.5 py-0.5 rounded-full font-semibold border ${roleBadge(selectedStaffDetail.role)}`}>
                  {selectedStaffDetail.role}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="dark:text-zinc-400 text-zinc-500">Kullanıcı Kimliği:</span>
                <span className="font-mono dark:text-zinc-300 text-zinc-700">{selectedStaffDetail.id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="dark:text-zinc-400 text-zinc-500">Kiracı / Şube:</span>
                <span className="dark:text-zinc-300 text-zinc-700">{selectedStaffDetail.tenant_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="dark:text-zinc-400 text-zinc-500">Giriş Doğrulama:</span>
                <span className="text-emerald-500 font-medium flex items-center gap-1">
                  <Lock size={12} /> Aktif PIN Doğrulaması
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t dark:border-white/10 border-black/[0.08]">
              {selectedStaffDetail.id !== user?.userId && (
                <button
                  onClick={() => {
                    const member = selectedStaffDetail;
                    setSelectedStaffDetail(null);
                    setStaffToDelete(member);
                  }}
                  className="px-4 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-500 rounded-2xl text-xs font-bold transition-all cursor-pointer"
                >
                  Personeli Sil
                </button>
              )}
              <button
                onClick={() => setSelectedStaffDetail(null)}
                className="px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-white text-zinc-800 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
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
