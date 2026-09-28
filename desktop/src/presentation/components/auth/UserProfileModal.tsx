import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import {
  User,
  Shield,
  Building2,
  KeyRound,
  Lock,
  LogOut,
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  MASTER: { label: 'Platform Yöneticisi', color: 'bg-[#5856D6]/15 text-[#5856D6] border-[#5856D6]/30' },
  OWNER: { label: 'İşletme Sahibi (Patron)', color: 'bg-[#FF9500]/15 text-[#FF9500] border-[#FF9500]/30' },
  MANAGER: { label: 'Restoran Müdürü', color: 'bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30' },
  CASHIER: { label: 'Kasiyer', color: 'bg-[#34C759]/15 text-[#34C759] border-[#34C759]/30' },
  WAITER: { label: 'Servis / Garson', color: 'bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30' },
  KITCHEN: { label: 'Mutfak / KDS', color: 'bg-[#FF9500]/15 text-[#FF9500] border-[#FF9500]/30' },
};

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps): JSX.Element | null {
  const { user, branchName, lock, logout, changePin } = useAuthStore();
  
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  if (!isOpen || !user) return null;

  const roleInfo = ROLE_LABELS[user.role] || {
    label: user.role,
    color: 'bg-white/10 text-zinc-300 border-white/10',
  };

  const handlePinUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    setPinSuccess('');

    // PIN uzunluğu denetimi: en az 4, en fazla 8 hane
    if (newPin.length < 4 || newPin.length > 8) {
      setPinError('Yeni PIN kodu 4 ila 8 haneli olmalıdır.');
      return;
    }

    if (!/^\d+$/.test(newPin)) {
      setPinError('PIN kodu yalnızca rakamlardan oluşmalıdır.');
      return;
    }

    if (newPin !== confirmPin) {
      setPinError('Yeni PIN kodları birbiriyle eşleşmiyor.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (changePin) {
        await changePin(newPin, currentPin || undefined);
      } else {
        const { tauriInvoke } = await import('../../../data/ipc/tauriInvoke');
        await tauriInvoke('change_self_pin', {
          user_id: user.userId,
          userId: user.userId,
          current_pin: currentPin || undefined,
          currentPin: currentPin || undefined,
          new_pin: newPin,
          newPin: newPin,
        });
      }

      setPinSuccess('PIN kodunuz başarıyla güncellendi.');
      toast.success('Giriş PIN kodunuz güncellendi.');
      setNewPin('');
      setConfirmPin('');
      setCurrentPin('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPinError(msg || 'PIN güncellenemedi. Lütfen tekrar deneyin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLockScreen = () => {
    onClose();
    lock();
  };

  const handleHardLogout = () => {
    setShowLogoutConfirm(false);
    onClose();
    logout();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-lg rounded-3xl border dark:border-white/10 border-black/10 dark:bg-[#16171b]/95 bg-white/95 shadow-2xl backdrop-blur-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b dark:border-white/10 border-black/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/10 dark:text-white text-zinc-800">
              <User size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold dark:text-white text-zinc-900 tracking-tight">Personel Profili</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* User Info Card */}
          <div className="rounded-2xl border dark:border-white/10 border-black/10 dark:bg-[#1c1d22]/90 bg-black/[0.02] p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Giriş Yapan Personel
                </span>
                <h3 className="text-lg font-semibold dark:text-white text-zinc-900 mt-0.5">{user.name}</h3>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${roleInfo.color}`}>
                <Shield size={12} />
                <span>{roleInfo.label}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t dark:border-white/10 border-black/10 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                <Building2 size={14} className="text-[#007AFF]" />
                <span className="truncate">{branchName || 'Kadıköy Merkez Şube'}</span>
              </div>
              <div className="flex items-center justify-end gap-1.5 text-[#34C759]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#34C759]"></span>
                <span>Cihaz Oturumu Aktif</span>
              </div>
            </div>
          </div>

          {/* PIN Management Section (Min 4, Max 8 haneli) */}
          <div className="rounded-2xl border dark:border-white/10 border-black/10 dark:bg-[#1c1d22]/90 bg-black/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 dark:text-white text-zinc-900 font-semibold text-sm">
                <KeyRound size={16} className="text-[#FF9500]" />
                <span>Giriş PIN Kodu Belirle / Değiştir</span>
              </div>
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-black/[0.04] dark:bg-white/[0.04] px-2 py-0.5 rounded-full border dark:border-white/10 border-black/10">
                Min 4 - Max 8 Hane
              </span>
            </div>

            {pinError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20 text-xs text-[#FF3B30] animate-in fade-in">
                <AlertCircle size={15} className="shrink-0 text-[#FF3B30] mt-0.5" />
                <span>{pinError}</span>
              </div>
            )}

            {pinSuccess && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#34C759]/10 border border-[#34C759]/20 text-xs text-[#34C759] animate-in fade-in">
                <CheckCircle2 size={15} className="shrink-0 text-[#34C759]" />
                <span>{pinSuccess}</span>
              </div>
            )}

            <form onSubmit={handlePinUpdate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium dark:text-zinc-300 text-zinc-700 mb-1">
                  Mevcut PIN
                </label>
                <input
                  type={showPin ? 'text' : 'password'}
                  maxLength={8}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Mevcut PIN"
                  className="w-full px-3.5 py-2.5 rounded-xl dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/10 dark:text-white text-zinc-900 text-sm font-mono tracking-widest focus:outline-none focus:border-[#007AFF] transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium dark:text-zinc-300 text-zinc-700">
                      Yeni PIN (4-8 Rakam) *
                    </label>
                    <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                      {newPin.length}/8
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={showPin ? 'text' : 'password'}
                      required
                      maxLength={8}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Yeni PIN (4-8 hane)"
                      className="w-full pl-3.5 pr-9 py-2.5 rounded-xl dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/10 dark:text-white text-zinc-900 text-sm font-mono tracking-widest focus:outline-none focus:border-[#007AFF] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium dark:text-zinc-300 text-zinc-700">
                      Yeni PIN Tekrar *
                    </label>
                    <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                      {confirmPin.length}/8
                    </span>
                  </div>
                  <input
                    type={showPin ? 'text' : 'password'}
                    required
                    maxLength={8}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Yeni PIN Tekrar"
                    className="w-full px-3.5 py-2.5 rounded-xl dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/10 dark:text-white text-zinc-900 text-sm font-mono tracking-widest focus:outline-none focus:border-[#007AFF] transition-colors"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || newPin.length < 4 || newPin.length > 8}
                  className="px-4 py-2.5 rounded-full bg-[#007AFF] hover:bg-[#007AFF]/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  <span>PIN Kodunu Güncelle</span>
                </button>
              </div>
            </form>
          </div>

          {/* Quick Terminal Actions */}
          <div className="space-y-2 pt-2">
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
              Terminal Hızlı İşlemleri
            </span>

            {/* Lock Action */}
            <button
              type="button"
              onClick={handleLockScreen}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl dark:bg-[#1c1d22]/90 bg-black/[0.02] hover:dark:bg-[#1c1d22] hover:bg-black/[0.05] border dark:border-white/10 border-black/10 text-left transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20">
                  <Lock size={16} />
                </div>
                <div>
                  <div className="text-xs font-semibold dark:text-white text-zinc-900 group-hover:text-[#FF9500] transition-colors">
                    Ekranı Kilitle (PIN Modu)
                  </div>
                </div>
              </div>
              <ChevronRight size={16} className="text-zinc-400 dark:text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Hard Logout Action */}
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#FF3B30]/10 hover:bg-[#FF3B30]/15 border border-[#FF3B30]/20 text-left transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#FF3B30]/15 text-[#FF3B30] border border-[#FF3B30]/25">
                  <LogOut size={16} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#FF3B30] group-hover:text-[#FF3B30]/80 transition-colors">
                    Tam Çıkış Yap (Terminali Kapat)
                  </div>
                </div>
              </div>
              <ChevronRight size={16} className="text-[#FF3B30] group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t dark:border-white/10 border-black/10 px-6 py-3 dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#007AFF]"></span>
            <span>KASAM360 Terminal Oturumu</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-full dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] hover:bg-black/[0.1] border dark:border-white/10 border-black/10 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 text-xs font-medium transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>

      {/* Hard Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border dark:border-white/10 border-black/10 dark:bg-[#16171b]/95 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3 text-[#FF3B30]">
              <div className="p-2.5 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20">
                <LogOut size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold dark:text-white text-zinc-900">Terminali Kapat</h3>
              </div>
            </div>
            
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Cihaz oturumunu kapatıp giriş ekranına dönmek istediğinize emin misiniz? Tekrar açmak için kullanıcı adı ve şifreniz gerekecektir.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 rounded-full dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] hover:bg-black/[0.1] border dark:border-white/10 border-black/10 text-zinc-700 dark:text-zinc-300 hover:dark:text-white hover:text-zinc-900 text-xs font-medium transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleHardLogout}
                className="px-4 py-2 rounded-full bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                Evet, Tam Çıkış Yap
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
