import { useEffect, useState } from 'react';
import { Printer, Cloud, Lock, LogOut, ArrowLeft } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';

export function TopHeader() {
  const [time, setTime] = useState(new Date());
  const currentView = useCartStore((state) => state.currentView);
  const navigate = useCartStore((state) => state.navigate);
  const { user, logout, lock } = useAuthStore();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4">
      {/* Left side */}
      <div className="flex items-center gap-4">
        {currentView === 'POS' && (
          <button
            onClick={() => navigate('FLOOR')}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            <ArrowLeft size={18} />
            Masalara Dön
          </button>
        )}
        <h1 className="text-xl font-bold tracking-wide text-slate-100">KASAM360</h1>
        <div className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300">
          Açık Adisyon: <span className="font-semibold text-white">0</span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-6">
        {/* Hardware Status */}
        <div className="flex items-center gap-3 text-slate-400">
          <div className="flex items-center gap-1.5" title="Yazıcı Bağlantısı Aktif">
            <Printer size={18} />
            <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          </div>
          <div className="flex items-center gap-1.5" title="Bulut Senkronizasyonu Aktif">
            <Cloud size={18} />
            <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          </div>
        </div>

        {/* Real-time Clock */}
        <div className="font-mono text-lg font-medium text-slate-200">
          {time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </div>

        {/* Impersonation / IT Remote Modu Bildirimi & Geri Dönüş */}
        {user?.userId?.startsWith('impersonate_') && (
          <button
            onClick={() => {
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
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md animate-pulse"
            title="Uzaktan Gözlemci Modundan Çık ve Master Admin Paneline Dön"
          >
            <span>IT Canlı Moddan Çık (Master Admin)</span>
          </button>
        )}

        {/* User Info */}
        <div className="text-sm font-medium text-slate-300">
          {user?.role}: <span className="text-white">{user?.name}</span>
        </div>

        {/* Ekranı Kilitle / Hızlı Kullanıcı Değiştir Butonu */}
        <button 
          onClick={lock}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 transition-colors hover:bg-amber-600 hover:text-white text-xs font-semibold"
          title="Ekranı Kilitle / Hızlı Kullanıcı Değiştir (PIN ile Aç)"
        >
          <Lock size={16} />
          <span className="hidden md:inline">Kilitle</span>
        </button>

        {/* Tam Çıkış Yap (Oturumu Kapat) Butonu */}
        <button 
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 transition-colors hover:bg-red-600 hover:text-white text-xs font-semibold"
          title="Tam Çıkış Yap (Oturumu Kapat & Ana Girişe Dön)"
        >
          <LogOut size={16} />
          <span className="hidden md:inline">Çıkış</span>
        </button>
      </div>
    </header>
  );
}
