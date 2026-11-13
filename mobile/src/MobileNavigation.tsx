import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpFromLine, BarChart3, BookOpen, BookUser, LayoutGrid, Lock, MoreHorizontal, Moon, Plus, Settings,
  ShoppingBag, Sun, Tv, Wallet, X, Zap,
} from 'lucide-react';
import { canOpenModule } from '../../desktop/src/lib/roleAccess';
import { useAuthStore } from '../../desktop/src/stores/authStore';
import { useFeatureStore } from '../../desktop/src/stores/featureStore';
import { useKdsStore } from '../../desktop/src/stores/kdsStore';
import { usePosStore } from '../../desktop/src/stores/posStore';
import { useLedgerStore } from '../../desktop/src/stores/ledgerStore';
import { useUIStore, type AppModule } from '../../desktop/src/stores/uiStore';
import { buildNavSections, initials, MODULE_LABEL, ROLE_TITLE, type NavEntry } from '../../desktop/src/features/shell/shellModel';
import { quickActionsFor, type QuickAction, type QuickActionId } from '../../desktop/src/features/shell/mobileShellModel';
import { useFocusTrap } from '../../desktop/src/ui/useFocusTrap';

const ALL_MODULES: AppModule[] = ['FLOOR', 'POS', 'KDS', 'CASHIER', 'ERP', 'CATALOG', 'SETTINGS'];
const ICONS = { FLOOR: LayoutGrid, POS: ShoppingBag, KDS: Tv, CASHIER: Wallet, ERP: BarChart3, CATALOG: BookOpen, SETTINGS: Settings };
const QUICK_ICONS: Record<QuickActionId, typeof Plus> = {
  NEW_ORDER: ShoppingBag, QUICK_SALE: Zap, COLLECT: Wallet, CASH_OUT: ArrowUpFromLine, LEDGER: BookUser,
};

type SheetKind = 'more' | 'quick';

/** Alttan açılan cam sayfa: odak içeride kalır, Esc ve perdeye dokunma kapatır. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="mobile-sheet-root glass-scrim" onClick={onClose}>
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="mobile-sheet glass-panel" onClick={(event) => event.stopPropagation()}>
      <span className="mobile-sheet-grip" aria-hidden="true" />
      <div className="mobile-sheet-head"><strong>{title}</strong><button type="button" aria-label="Kapat" onClick={onClose}><X aria-hidden="true" /></button></div>
      {children}
    </div>
  </div>;
}

export function MobileNavigation() {
  const user = useAuthStore((state) => state.user);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const locked = useAuthStore((state) => state.isLocked);
  const lock = useAuthStore((state) => state.lock);
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);
  const isEnabled = useFeatureStore((state) => state.isEnabled);
  const kdsCount = useKdsStore((state) => state.tickets.length);
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  const modules = useMemo(() => ALL_MODULES.filter((module) => {
    if (module === 'KDS' && !isEnabled('feat_kds')) return false;
    if (module === 'POS' && user?.role === 'WAITER') return false;
    return canOpenModule(user?.role, module);
  }), [isEnabled, user?.role]);
  const quickActions = useMemo(() => quickActionsFor(user?.role, isEnabled), [isEnabled, user?.role]);
  // Sekme çubuğunda dört bölüm görünür; tüm gruplar "Diğer" çekmecesindedir.
  const primary = modules.slice(0, 4);
  const sections = useMemo(() => {
    const entries: NavEntry[] = ALL_MODULES.map((id) => ({
      id, label: MODULE_LABEL[id], visible: modules.includes(id), badge: id === 'KDS' && kdsCount > 0 ? kdsCount : undefined,
    }));
    return buildNavSections(entries, '');
  }, [modules, kdsCount]);

  useEffect(() => {
    if (!authenticated || locked) return;
    const onBack = () => {
      const openModal = Object.entries(useUIStore.getState().modals).find(([, open]) => open)?.[0] as keyof typeof modals | undefined;
      if (openModal) closeModal(openModal);
      else if (sheet) setSheet(null);
      else setActiveModule(modules[0] ?? 'FLOOR');
      window.history.pushState({ kasamMobile: true }, '', '#app');
    };
    window.history.pushState({ kasamMobile: true }, '', '#app');
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [authenticated, closeModal, locked, modals, modules, sheet, setActiveModule]);

  // Kilit veya oturum kapanınca açık sayfa kalmaz; önceki kullanıcının kısayolu taşınmaz.
  useEffect(() => { if (!authenticated || locked) setSheet(null); }, [authenticated, locked]);

  if (!authenticated || locked) return null;

  const go = (module: AppModule) => { setActiveModule(module); setSheet(null); };
  const runQuick = (action: QuickAction) => {
    if (action.id === 'QUICK_SALE') void usePosStore.getState().openWalkinOrder();
    setActiveModule(action.module);
    if (action.erpTab) useLedgerStore.getState().setActiveErpTab(action.erpTab);
    setSheet(null);
  };
  const isDark = theme === 'dark';
  const tabs: ReactNode[] = primary.map((module) => {
    const Icon = ICONS[module];
    return <button key={module} type="button" className="mobile-nav-item" aria-current={activeModule === module ? 'page' : undefined} onClick={() => go(module)}>
      <Icon aria-hidden="true" /><span>{MODULE_LABEL[module]}</span>
    </button>;
  });
  // "+" düğmesi sekmelerin ortasındadır; yetkili kısayol yoksa hiç gösterilmez.
  if (quickActions.length > 0) {
    tabs.splice(Math.ceil(tabs.length / 2), 0, <button key="quick" type="button" className="mobile-quick-fab" aria-label="Hızlı işlem" aria-haspopup="dialog" aria-expanded={sheet === 'quick'} onClick={() => setSheet(sheet === 'quick' ? null : 'quick')}><Plus aria-hidden="true" /></button>);
  }

  return <>
    {sheet === 'more' && <Sheet title="Diğer bölümler" onClose={() => setSheet(null)}>
      <nav className="mobile-sheet-body" aria-label="Tüm bölümler">
        {sections.map((section) => <div key={section.id} role="group" aria-label={section.title} className="side-group">
          <span className="side-group-title" aria-hidden="true">{section.title}</span>
          {section.items.map((item) => {
            const Icon = ICONS[item.id];
            return <button key={item.id} type="button" className="side-item" aria-current={activeModule === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
              <Icon aria-hidden="true" /><span className="side-item-label">{item.label}</span>
              {item.badge ? <span className="side-badge">{item.badge}</span> : null}
            </button>;
          })}
        </div>)}
      </nav>
      <div className="side-foot">
        <div className="side-switch-row">
          <span className="side-switch-label">{isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}<span className="side-item-label">Koyu mod</span></span>
          <button type="button" role="switch" aria-checked={isDark} aria-label="Koyu mod" className="side-switch" onClick={() => setTheme(isDark ? 'light' : 'dark')}><span className="side-switch-knob" /></button>
        </div>
        {user && <div className="side-user">
          <span className="side-avatar" aria-hidden="true">{initials(user.name)}</span>
          <span className="side-user-text"><span className="side-user-name">{user.name}</span><span className="side-user-role">{ROLE_TITLE[user.role]}</span></span>
          <button type="button" className="side-user-lock" aria-label="Kilitle" onClick={() => { setSheet(null); lock(); }}><Lock aria-hidden="true" /></button>
        </div>}
      </div>
    </Sheet>}
    {sheet === 'quick' && <Sheet title="Hızlı işlem" onClose={() => setSheet(null)}>
      <div className="mobile-quick-grid">
        {quickActions.map((action) => {
          const Icon = QUICK_ICONS[action.id];
          return <button key={action.id} type="button" className="mobile-quick-action" onClick={() => runQuick(action)}><Icon aria-hidden="true" /><span>{action.label}</span></button>;
        })}
      </div>
    </Sheet>}
    {modules.length > 0 && <nav className="mobile-tabbar" aria-label="Ana gezinme">
      {tabs}
      <button type="button" className="mobile-nav-item" aria-haspopup="dialog" aria-expanded={sheet === 'more'} onClick={() => setSheet(sheet === 'more' ? null : 'more')}><MoreHorizontal aria-hidden="true" /><span>Diğer</span></button>
    </nav>}
  </>;
}
