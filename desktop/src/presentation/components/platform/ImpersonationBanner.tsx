import { LogOut, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore } from '../../store/useCartStore';

export function ImpersonationBanner(): JSX.Element | null {
  const user = useAuthStore((state) => state.user);

  if (!user?.userId?.startsWith('impersonate_')) {
    return null;
  }

  const handleExit = () => {
    // Master admin oturumuna geri dön
    useAuthStore.setState({
      user: {
        userId: 'usr_master',
        role: 'MASTER',
        name: 'Master Admin',
        tenantId: '',
        branchId: '',
        branchName: '',
      },
      branchId: '',
      branchName: '',
      isAuthenticated: true,
    });
    useCartStore.getState().navigate('PLATFORM');
  };

  return (
    <aside 
      aria-label="Canlı Sistem Gözlem Bildirimi"
      className="sticky top-0 z-[9999] w-full bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white px-4 py-2 shadow-lg flex items-center justify-between border-b border-red-500/40 animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold tracking-wide">
        <ShieldAlert size={18} className="animate-pulse shrink-0 text-white" />
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold uppercase tracking-wider bg-black/30 px-2 py-0.5 rounded text-[11px]">
            Canlı Gözlemci Modu
          </span>
          <span className="text-red-100">
            <strong>{user.branchName || user.tenantId || 'İşletme'}</strong> adına sistem oturumu yürütülüyor.
          </span>
        </span>
      </div>

      <button
        type="button"
        onClick={handleExit}
        className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-red-700 hover:text-red-800 text-xs font-bold rounded-lg shadow-sm transition-all transform active:scale-95 shrink-0"
        title="Canlı gözlemci oturumunu kapat ve Platform Konsoluna dön"
      >
        <LogOut size={14} />
        <span>Gözlem Modundan Çık</span>
      </button>
    </aside>
  );
}
