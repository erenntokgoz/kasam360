import { Armchair, Receipt, ChefHat, Clock, Settings, BarChart3, Banknote } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

/**
 * macOS Dock tarzında dikeyde ortalanmış, buzlu cam (frosted glass) sol gezinme çubuğu.
 * Bağımsız POS sekmesi kaldırılmıştır — sipariş süreci Masalar (FLOOR) üzerinden yürütülür.
 */
export function GlobalNav() {
  const currentView = useCartStore((state) => state.currentView);
  const navigate = useCartStore((state) => state.navigate);
  const user = useAuthStore((state) => state.user);
  const { isKdsEnabled, isTableOrderEnabled, isLedgerCariEnabled } = useFeatureFlags();

  const role = user?.role || 'WAITER';

  // MASTER rolü AppShell dışında PlatformContainer'da render edilir
  if (role === 'MASTER') return null;

  // Rol ve Modül Yetki Kontrolleri (Feature Flags ile korumalı)
  const canSeeCashier = ['CASHIER', 'OWNER'].includes(role);
  const canSeeFloor = ['WAITER', 'CASHIER', 'MANAGER', 'OWNER'].includes(role) && isTableOrderEnabled;
  const canSeeReceipts = ['CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeKds = ['KITCHEN', 'MANAGER', 'OWNER'].includes(role) && isKdsEnabled;
  const canSeeEndOfDay = ['MANAGER', 'OWNER'].includes(role) && isLedgerCariEnabled;
  const canSeeOwnerDashboard = role === 'OWNER';
  const canSeeManagement = role === 'MANAGER';

  return (
    // macOS tarzı dikeyde ortalanmış, önde süzülen bağımsız şeffaf cam (frosted glass) kapsül
    <nav className="my-auto self-center flex h-fit max-h-[calc(100vh-theme(spacing.20))] overflow-y-auto no-scrollbar w-[70px] shrink-0 flex-col items-center gap-1 rounded-3xl backdrop-blur-2xl dark:bg-white/[0.04] bg-white/80 border dark:border-white/10 border-black/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] py-2.5 px-1 z-40 select-none transition-all duration-200">
      {canSeeFloor && (
        <NavItem
          icon={<Armchair size={20} className="stroke-[1.6]" />}
          label="Masalar"
          active={currentView === 'FLOOR' || currentView === 'POS'}
          onClick={() => navigate('FLOOR')}
        />
      )}
      {canSeeCashier && (
        <NavItem
          icon={<Banknote size={20} className="stroke-[1.6]" />}
          label="Kasa"
          active={currentView === 'CASHIER'}
          onClick={() => navigate('CASHIER')}
        />
      )}
      {canSeeReceipts && (
        <NavItem
          icon={<Receipt size={20} className="stroke-[1.6]" />}
          label="Fişler"
          active={currentView === 'RECEIPTS'}
          onClick={() => navigate('RECEIPTS')}
        />
      )}
      {canSeeKds && (
        <NavItem
          icon={<ChefHat size={20} className="stroke-[1.6]" />}
          label="KDS"
          active={currentView === 'KDS'}
          onClick={() => navigate('KDS')}
        />
      )}
      {canSeeEndOfDay && (
        <NavItem
          icon={<Clock size={20} className="stroke-[1.6]" />}
          label="Hesap Defteri"
          active={currentView === 'END_OF_DAY'}
          onClick={() => navigate('END_OF_DAY')}
        />
      )}
      {(canSeeOwnerDashboard || canSeeManagement) && (
        <div className="flex flex-col gap-1 pt-1.5 border-t dark:border-white/10 border-black/[0.08] w-full items-center">
          {canSeeOwnerDashboard && (
            <NavItem
              icon={<BarChart3 size={20} className="stroke-[1.6]" />}
              label="İşletme"
              active={currentView === 'OWNER_DASHBOARD'}
              onClick={() => navigate('OWNER_DASHBOARD')}
            />
          )}
          {canSeeManagement && (
            <NavItem
              icon={<Settings size={20} className="stroke-[1.6]" />}
              label="Yönetim"
              active={currentView === 'MANAGEMENT'}
              onClick={() => navigate('MANAGEMENT')}
            />
          )}
        </div>
      )}
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex w-full min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-all duration-150 ease-out active:scale-90 cursor-pointer touch-manipulation focus-visible:outline-none ${
        active
          ? 'dark:bg-white/15 bg-black/5 text-[#007AFF] shadow-sm'
          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
      }`}
    >
      {/* Aktif sekmede sol kenarda şık Apple parlama çizgisi */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-[#007AFF] shadow-[0_0_8px_#007AFF]" />
      )}
      <div className={`transition-transform duration-150 group-hover:scale-105 ${active ? 'text-[#007AFF]' : ''}`}>
        {icon}
      </div>
      <span className="text-[10px] font-medium tracking-tight leading-none">
        {label}
      </span>
    </button>
  );
}
