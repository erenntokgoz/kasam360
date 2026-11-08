import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookOpen, LayoutGrid, MoreHorizontal, ShoppingBag, Tv, Wallet, X } from 'lucide-react';
import { canOpenModule } from '../../desktop/src/lib/roleAccess';
import { useAuthStore } from '../../desktop/src/stores/authStore';
import { useFeatureStore } from '../../desktop/src/stores/featureStore';
import { useUIStore, type AppModule } from '../../desktop/src/stores/uiStore';

const labels: Record<AppModule, string> = {
  FLOOR: 'Salon', POS: 'Sipariş', KDS: 'Mutfak', CASHIER: 'Kasa', ERP: 'Yönetim', CATALOG: 'Menü', SETTINGS: 'Ayarlar',
};
const icons = { FLOOR: LayoutGrid, POS: ShoppingBag, KDS: Tv, CASHIER: Wallet, ERP: BarChart3, CATALOG: BookOpen, SETTINGS: MoreHorizontal };

export function MobileNavigation() {
  const user = useAuthStore((state) => state.user);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const locked = useAuthStore((state) => state.isLocked);
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);
  const isEnabled = useFeatureStore((state) => state.isEnabled);
  const [moreOpen, setMoreOpen] = useState(false);

  const modules = useMemo(() => (['FLOOR', 'POS', 'KDS', 'CASHIER', 'ERP', 'CATALOG', 'SETTINGS'] as AppModule[]).filter((module) => {
    if (module === 'KDS' && !isEnabled('feat_kds')) return false;
    if (module === 'POS' && user?.role === 'WAITER') return false;
    return canOpenModule(user?.role, module);
  }), [isEnabled, user?.role]);
  const primary = modules.slice(0, 4);
  const secondary = modules.slice(4);

  useEffect(() => {
    if (!authenticated || locked) return;
    const onBack = () => {
      const openModal = Object.entries(useUIStore.getState().modals).find(([, open]) => open)?.[0] as keyof typeof modals | undefined;
      if (openModal) closeModal(openModal);
      else if (moreOpen) setMoreOpen(false);
      else setActiveModule(modules[0] ?? 'FLOOR');
      window.history.pushState({ kasamMobile: true }, '', '#app');
    };
    window.history.pushState({ kasamMobile: true }, '', '#app');
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [authenticated, closeModal, locked, modals, modules, moreOpen, setActiveModule]);

  if (!authenticated || locked) return null;
  const renderButton = (module: AppModule) => {
    const Icon = icons[module];
    return <button key={module} type="button" className="mobile-nav-item" aria-current={activeModule === module ? 'page' : undefined} onClick={() => { setActiveModule(module); setMoreOpen(false); }}>
      <Icon aria-hidden="true" /><span>{labels[module]}</span>
    </button>;
  };

  return <>
    {moreOpen && <div className="mobile-more-panel" role="dialog" aria-label="Diğer bölümler">
      <div className="mobile-more-head"><strong>Diğer bölümler</strong><button type="button" aria-label="Kapat" onClick={() => setMoreOpen(false)}><X /></button></div>
      {secondary.map(renderButton)}
    </div>}
    {modules.length > 0 && <nav className="mobile-tabbar" aria-label="Ana gezinme">
      {primary.map(renderButton)}
      {secondary.length > 0 && <button type="button" className="mobile-nav-item" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal aria-hidden="true" /><span>Diğer</span></button>}
    </nav>}
  </>;
}
