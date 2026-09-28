import { useEffect, useState } from 'react';
import { Printer, Cloud, Lock, LogOut, ArrowLeft, ChevronDown, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useFloorStore } from '../../store/useFloorStore';
import { UserProfileModal } from '../auth/UserProfileModal';

/**
 * macOS Frosted Glass üst bilgi ve aksiyon çubuğu.
 * Dengeli buton boyutları, net tipografi ve macOS saydamlık efektleri içerir.
 */
export function TopHeader() {
  const [time, setTime] = useState(new Date());
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const currentView = useCartStore((state) => state.currentView);
  const navigate = useCartStore((state) => state.navigate);
  const { user, logout, lock, branchName } = useAuthStore();
  const openOrdersCount = useFloorStore((state) => state.tables.filter((t) => t.status === 'OCCUPIED').length);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <>
      <header className="mx-3.5 mt-3.5 flex h-14 shrink-0 items-center justify-between rounded-2xl border dark:border-white/10 border-black/[0.08] backdrop-blur-2xl dark:bg-white/[0.03] bg-white/80 px-5 select-none z-20 shadow-[0_4px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.2)] transition-colors duration-200">
        {/* Sol Alan: Masalara Dönüş, Logo ve Şube Bilgisi */}
        <div className="flex items-center gap-3.5">
          {currentView === 'POS' && (
            <button
              onClick={() => navigate('FLOOR')}
              title="Masalar Ekranına Dön"
              className="flex items-center gap-2 rounded-xl dark:bg-white/5 bg-black/5 hover:dark:bg-white/10 hover:bg-black/10 border dark:border-white/10 border-black/10 px-3.5 py-1.5 text-xs font-medium dark:text-white text-zinc-900 transition-all active:scale-95 touch-manipulation cursor-pointer"
            >
              <ArrowLeft size={15} className="stroke-[2]" />
              <span>Masalar</span>
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <span className="text-base font-bold tracking-tight dark:text-white text-zinc-900">KASAM<span className="text-[#007AFF]">360</span></span>
            {branchName && (
              <span className="text-xs font-normal dark:text-zinc-400 text-zinc-600 dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 px-3 py-1 rounded-full hidden sm:inline">
                {branchName}
              </span>
            )}
          </div>
          {openOrdersCount > 0 && (
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,199,89,0.8)]" />
              <span>{openOrdersCount}</span>
            </div>
          )}
        </div>

        {/* Sağ Alan: Cihaz Durumları, Saat, Profil, Tema, Kilit ve Çıkış Butonları */}
        <div className="flex items-center gap-2.5">
          {/* Donanım & Senkronizasyon Durum Noktaları */}
          <div className="flex items-center gap-3 dark:text-zinc-400 text-zinc-600 border-r dark:border-white/10 border-black/10 pr-3">
            <div className="flex items-center gap-1.5 text-xs" title="Yazıcı Servisi Çevrimiçi">
              <Printer size={15} />
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"></div>
            </div>
            <div className="flex items-center gap-1.5 text-xs" title="Yerel Veritabanı & Senkron Aktif">
              <Cloud size={15} />
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"></div>
            </div>
          </div>

          {/* Gerçek Zamanlı Saat */}
          <div className="font-mono text-xs font-medium dark:text-zinc-300 text-zinc-600 px-1">
            {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </div>

          {/* Sağ Üst Profil Alanı (Apple Frosted Pill Kapsülü) */}
          <button
            type="button"
            onClick={() => setIsProfileOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 hover:dark:bg-white/10 hover:bg-black/10 transition-all cursor-pointer group active:scale-95 touch-manipulation"
            title="Personel Profilini ve PIN Ayarlarını Aç"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#007AFF] text-white font-semibold text-xs shadow-sm">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'P'}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-medium dark:text-zinc-200 text-zinc-900 group-hover:text-[#007AFF] transition-colors truncate max-w-[120px]">
                {user?.name || 'Personel'}
              </span>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#007AFF] bg-[#007AFF]/15 px-2 py-0.5 rounded-full border border-[#007AFF]/20">
              {user?.role || 'Kullanıcı'}
            </span>
            <ChevronDown size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors" />
          </button>

          {/* Tema Değiştir Butonu — Dark/Light geçişi */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center justify-center h-8 w-8 rounded-xl dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/10 transition-all hover:scale-105 active:scale-95 text-xs font-medium touch-manipulation cursor-pointer"
            title={theme === 'dark' ? 'Açık Temaya Geç' : 'Koyu Temaya Geç'}
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-indigo-600 dark:text-indigo-400" />}
          </button>

          {/* Ekranı Kilitle Butonu */}
          <button 
            type="button"
            onClick={lock}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 dark:text-zinc-300 text-zinc-700 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/10 transition-all hover:scale-105 text-xs font-medium touch-manipulation active:scale-95 cursor-pointer"
            title="Ekranı Kilitle (PIN ile Aç)"
          >
            <Lock size={14} />
            <span className="hidden sm:inline">Kilitle</span>
          </button>

          {/* Oturumu Kapat Butonu */}
          <button 
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl dark:bg-white/5 bg-black/5 border dark:border-white/10 border-black/10 dark:text-zinc-300 text-zinc-700 hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 hover:border-[#FF3B30]/30 transition-all active:scale-95 text-xs font-medium touch-manipulation cursor-pointer"
            title="Oturumu Kapat"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </header>

      {/* Profil ve PIN Yönetimi Modalı */}
      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      {/* Oturumu Kapatma Onay Diyaloğu */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border dark:border-white/10 border-black/10 dark:bg-[#16171b]/95 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold dark:text-white text-zinc-900 mb-2">Oturumu Kapat</h3>
            <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-6">
              Kullanıcı oturumunu kapatıp giriş ekranına dönmek istediğinize emin misiniz?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 rounded-full dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] hover:bg-black/[0.1] border dark:border-white/10 border-black/10 dark:text-white text-zinc-800 text-xs font-medium transition-all cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
                className="px-4 py-2 rounded-full bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white text-xs font-semibold shadow-md transition-all active:scale-95 cursor-pointer"
              >
                Çıkış Yap
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
