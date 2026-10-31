import React from 'react';
import { LayoutGrid, ShoppingBag, Tv, Wallet, BarChart3 } from 'lucide-react';
import { useUIStore, type AppModule } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useFeatureStore } from '../../stores/featureStore';

export const SidebarNav: React.FC = () => {
  const { activeModule, setActiveModule } = useUIStore();
  const { user } = useAuthStore();
  const { tickets } = useKdsStore();
  const { isEnabled } = useFeatureStore();

  const canManage = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'MASTER';
  const activeKdsCount = tickets.filter((t) => !t.isCompleted).length;

  const navItems: Array<{
    id: AppModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    visible: boolean;
  }> = [
    {
      id: 'FLOOR',
      label: 'Salon',
      icon: LayoutGrid,
      visible: true,
    },
    {
      id: 'POS',
      label: 'Sipariş',
      icon: ShoppingBag,
      visible: true,
    },
    {
      id: 'KDS',
      label: 'Mutfak',
      icon: Tv,
      badge: activeKdsCount > 0 ? activeKdsCount : undefined,
      visible: isEnabled('feat_kds'),
    },
    {
      id: 'CASHIER',
      label: 'Kasa',
      icon: Wallet,
      visible: true,
    },
    {
      id: 'ERP',
      label: 'Yönetim',
      icon: BarChart3,
      visible: canManage,
    },
  ];

  return (
    <aside className="w-[72px] shrink-0 bg-[var(--bg-panel)] border-r border-[var(--border)] flex flex-col justify-between py-3 px-2 z-10 select-none">
      <nav className="flex flex-col gap-1.5" aria-label="Ana Menü">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
                className={`w-full py-2.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer relative transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border border-[var(--accent-amber-border)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {item.badge ? (
                  <span className="absolute top-1 right-2 px-1.5 py-0.2 rounded-full text-[10px] font-bold text-white bg-[var(--accent-amber)] tabular-nums shadow-sm">
                    {item.badge}
                  </span>
                ) : null}
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-[11px] tracking-tight">{item.label}</span>
              </button>
            );
          })}
      </nav>

      {/* Alt bilgi / Sürüm */}
      <div className="text-center pt-2 border-t border-[var(--border)]">
        <span className="text-[10px] font-mono text-[var(--text-muted)]">v3.0</span>
      </div>
    </aside>
  );
};
