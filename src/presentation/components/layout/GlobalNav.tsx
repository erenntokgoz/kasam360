import { LayoutGrid, Armchair, Receipt, ChefHat, Clock, Settings, BarChart3, Banknote } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';
import { useAuthStore } from '../../store/useAuthStore';

export function GlobalNav() {
  const currentView = useCartStore(state => state.currentView);
  const navigate = useCartStore(state => state.navigate);
  const user = useAuthStore(state => state.user);
  
  const role = user?.role || 'WAITER';

  // MASTER rolü AppShell dışında PlatformContainer'da render edilir,
  // dolayısıyla GlobalNav hiç gösterilmez.
  if (role === 'MASTER') return null;

  const canSeePos = role !== 'KITCHEN' && role !== 'CASHIER';
  const canSeeCashier = ['CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeFloor = role !== 'KITCHEN' && role !== 'CASHIER';
  const canSeeReceipts = ['CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeKds = true;
  const canSeeEndOfDay = ['MANAGER', 'OWNER'].includes(role);
  const canSeeOwnerDashboard = role === 'OWNER';
  const canSeeManagement = ['MANAGER', 'OWNER'].includes(role);

  return (
    <nav className="flex w-24 shrink-0 flex-col items-center gap-6 border-r border-slate-800 bg-slate-950 py-4">
      {canSeePos && (
        <NavItem 
          icon={<LayoutGrid size={24} />} 
          label="POS" 
          active={currentView === 'POS'} 
          onClick={() => navigate('POS')} 
        />
      )}
      {canSeeCashier && (
        <NavItem 
          icon={<Banknote size={24} />} 
          label="Kasa" 
          active={currentView === 'CASHIER'} 
          onClick={() => navigate('CASHIER')} 
        />
      )}
      {canSeeFloor && (
        <NavItem 
          icon={<Armchair size={24} />} 
          label="Masalar" 
          active={currentView === 'FLOOR'}
          onClick={() => navigate('FLOOR')} 
        />
      )}
      {canSeeReceipts && (
        <NavItem 
          icon={<Receipt size={24} />} 
          label="Fişler" 
          active={currentView === 'RECEIPTS'}
          onClick={() => navigate('RECEIPTS')}
        />
      )}
      {canSeeKds && (
        <NavItem 
          icon={<ChefHat size={24} />} 
          label="KDS" 
          active={currentView === 'KDS'}
          onClick={() => navigate('KDS')}
        />
      )}
      {canSeeEndOfDay && (
        <NavItem 
          icon={<Clock size={24} />} 
          label="Gün Sonu" 
          active={currentView === 'END_OF_DAY'}
          onClick={() => navigate('END_OF_DAY')}
        />
      )}
      {(canSeeOwnerDashboard || canSeeManagement) && (
        <div className="mt-auto flex flex-col gap-2">
          {canSeeOwnerDashboard && (
            <NavItem 
              icon={<BarChart3 size={24} />} 
              label="İşletme" 
              active={currentView === 'OWNER_DASHBOARD'}
              onClick={() => navigate('OWNER_DASHBOARD')} 
            />
          )}
          {canSeeManagement && (
            <NavItem 
              icon={<Settings size={24} />} 
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

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean, onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-16 flex-col items-center justify-center gap-1.5 rounded-xl p-3 transition-colors ${
        active
          ? 'bg-indigo-600 text-white shadow-md'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
}
