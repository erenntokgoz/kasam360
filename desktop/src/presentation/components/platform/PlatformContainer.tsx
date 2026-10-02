import { useState } from 'react';
import { PlatformDashboard } from './PlatformDashboard';
import { TenantManagement } from './TenantManagement';
import { PlatformBranchesPanel } from './ui/PlatformBranchesPanel';
import {
  LayoutDashboard,
  Building2,
  Lock,
  LogOut,
  Command,
  MapPin,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { AppBadge } from '../common/AppBadge';

/**
 * Apple macOS sistem ayarları ve yönetim konsolu standartlarında tasarlanmış
 * KASAM360 Platform Konteyneri (Master Admin Portal).
 */
export function PlatformContainer() {
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'TENANTS' | 'BRANCHES'>(
    'DASHBOARD',
  );
  const user = useAuthStore(s => s.user);
  const lock = useAuthStore(s => s.lock);
  const logout = useAuthStore(s => s.logout);

  // Faz 6: şube yazımı MASTER'a taşındı; panel `feat_multi_branch` kapalı
  // işletmede 404 yüzeyi gösterir.
  const navItems = [
    { id: 'DASHBOARD' as const, label: 'Platform Özeti', icon: LayoutDashboard },
    { id: 'TENANTS' as const, label: 'İşletme Yönetimi', icon: Building2 },
    { id: 'BRANCHES' as const, label: 'Şube Yönetimi', icon: MapPin },
  ];

  return (
    <div className="flex h-screen w-full dark:bg-[#060609] bg-[#f5f5f7] dark:text-zinc-100 text-zinc-900 overflow-hidden font-sans select-none">
      {/* Apple Tarzı Yarı Saydam Sidebar */}
      <div className="w-64 border-r dark:border-white/10 border-black/[0.08] dark:bg-white/[0.04] bg-white/80 backdrop-blur-2xl p-5 flex flex-col justify-between flex-shrink-0">
        <div>
          {/* Logo & Marka Bloğu */}
          <div className="flex items-center gap-3 mb-7 px-1 py-1">
            <div className="w-9 h-9 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] border dark:border-white/10 border-black/[0.08] flex items-center justify-center dark:text-white text-zinc-900 shadow-sm">
              <Command size={17} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-tight dark:text-white text-zinc-900 font-mono">KASAM360</span>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/60 text-zinc-600 border dark:border-white/[0.08] border-black/[0.08]">
                  MASTER
                </span>
              </div>
              <p className="text-[11px] text-white/40 mt-0.5">Yönetici Konsolu</p>
            </div>
          </div>

          {/* Navigasyon Sekmeleri */}
          <nav className="space-y-1.5">
            {navItems.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white/[0.09] text-white border border-white/[0.1] shadow-sm font-semibold'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-white' : 'text-white/40'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Alt Kullanıcı Bilgisi & Güvenli Çıkış */}
        <div className="pt-5 border-t border-white/[0.06] text-xs space-y-3.5">
          <div className="flex items-center gap-3 px-1">
            <div className="w-9 h-9 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-white flex items-center justify-center font-semibold font-mono text-xs shrink-0 shadow-inner">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'MA'}
            </div>
            <div className="overflow-hidden flex-1">
              <div className="text-white font-medium truncate text-xs">{user?.name || user?.userId || 'Sistem Yöneticisi'}</div>
              <div className="text-[10px] text-white/40 font-mono">Platform Admin</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => lock()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/80 hover:text-white transition-all text-[11px] font-medium border border-white/[0.08] cursor-pointer active:scale-95"
              title="Ekranı Kilitle"
            >
              <Lock size={12} />
              <span>Kilitle</span>
            </button>
            <button
              onClick={() => logout()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 transition-all text-[11px] font-medium border border-rose-500/20 cursor-pointer active:scale-95"
              title="Oturumu Kapat"
            >
              <LogOut size={12} />
              <span>Çıkış</span>
            </button>
          </div>
        </div>
      </div>

      {/* Ana Çalışma Alanı */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden dark:bg-[#060609] bg-[#f5f5f7]">
        {/* Üst İdari Bar (Apple Tarzı Breadcrumb & Sistem Durumu) */}
        <div className="h-14 border-b dark:border-white/10 border-black/[0.08] px-8 flex items-center justify-between dark:bg-white/[0.03] bg-white/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono dark:text-white/40 text-zinc-400 uppercase tracking-widest text-[10px]">KASAM360 CLOUD</span>
            <span className="dark:text-white/20 text-zinc-300">/</span>
            <span className="font-medium dark:text-white text-zinc-900">
              {activeTab === 'DASHBOARD' && 'Platform Özeti'}
              {activeTab === 'TENANTS' && 'İşletmeler'}
              {activeTab === 'BRANCHES' && 'Şubeler'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <AppBadge variant="success" dot={true}>
              SİSTEM AKTİF
            </AppBadge>
            <span className="text-[11px] dark:text-white/40 text-zinc-500 font-mono">v1.0.0-enterprise</span>
          </div>
        </div>

        {/* Sekme İçerikleri */}
        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === 'DASHBOARD' && <PlatformDashboard />}
          {activeTab === 'TENANTS' && <TenantManagement />}
          {activeTab === 'BRANCHES' && <PlatformBranchesPanel />}
        </div>
      </div>
    </div>
  );
}
