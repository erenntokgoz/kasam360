import React from 'react';
import { LayoutGrid, Lock, Moon, Settings, ShoppingBag, Sun, Tv, Wallet, BarChart3 } from 'lucide-react';
import { useUIStore, type AppModule } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useFeatureStore } from '../../stores/featureStore';
import { useShiftStore } from '../../stores/shiftStore';
import { canOpenModule } from '../../lib/roleAccess';
import { BrandMark } from '../../ui/BrandMark';
import { SyncStatusChip } from './SyncStatusChip';

export const SidebarNav: React.FC = () => {
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const openModal = useUIStore((state) => state.openModal);
  const user = useAuthStore((state) => state.user);
  const lock = useAuthStore((state) => state.lock);
  const isShiftOpen = useShiftStore((state) => state.activeShift?.isOpen ?? false);
  const activeKdsCount = useKdsStore((state) => state.tickets.length);
  const isEnabled = useFeatureStore((state) => state.isEnabled);

  const navItems: Array<{
    id: AppModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    visible: boolean;
  }> = [
    { id: 'FLOOR', label: 'Salon', icon: LayoutGrid, visible: canOpenModule(user?.role, 'FLOOR') },
    { id: 'POS', label: 'Sipariş', icon: ShoppingBag, visible: canOpenModule(user?.role, 'POS') },
    {
      id: 'KDS',
      label: 'Mutfak',
      icon: Tv,
      badge: activeKdsCount > 0 ? activeKdsCount : undefined,
      visible: isEnabled('feat_kds') && canOpenModule(user?.role, 'KDS'),
    },
    { id: 'CASHIER', label: 'Kasa', icon: Wallet, visible: canOpenModule(user?.role, 'CASHIER') },
    { id: 'ERP', label: 'Yönetim', icon: BarChart3, visible: canOpenModule(user?.role, 'ERP') },
    { id: 'SETTINGS', label: 'Ayarlar', icon: Settings, visible: canOpenModule(user?.role, 'SETTINGS') },
  ];

  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <aside className="side-rail">
      <div className="min-h-14 w-[72px] flex items-center justify-center shrink-0">
        <BrandMark className="w-8 h-8" surface="desk" />
      </div>

      <nav className="flex flex-col" aria-label="Ana Menü">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
                aria-current={activeModule === item.id ? 'page' : undefined}
                className="side-flag"
              >
                {item.badge ? (
                  <span className="absolute top-1 right-1.5 text-xs font-bold tabular-nums text-[var(--pen-red)]">{item.badge}</span>
                ) : null}
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
      </nav>

      <div className="mt-auto flex flex-col">
        {isShiftOpen ? null : (
          <button type="button" onClick={() => openModal('shiftGate')} className="side-tool !text-[var(--accent-amber)]">
            <span className="text-center">Vardiya kapalı</span>
          </button>
        )}
        <SyncStatusChip />
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="side-tool">
          <ThemeIcon className="w-5 h-5" />
          <span>{theme === 'dark' ? 'Açık' : 'Koyu'}</span>
        </button>
        <button type="button" onClick={lock} className="side-tool" title={user?.name}>
          <Lock className="w-5 h-5" />
          <span>Kilitle</span>
        </button>
      </div>
    </aside>
  );
};
