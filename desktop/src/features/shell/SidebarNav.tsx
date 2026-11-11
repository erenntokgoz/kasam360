import React, { useMemo, useState } from 'react';
import { BookOpen, LayoutGrid, Lock, Moon, Search, Settings, ShoppingBag, Sun, Tv, Wallet, BarChart3 } from 'lucide-react';
import { useUIStore, type AppModule } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useFeatureStore } from '../../stores/featureStore';
import { useSetupStore } from '../../stores/setupStore';
import { canOpenModule } from '../../lib/roleAccess';
import { BrandMark } from '../../ui/BrandMark';
import { buildNavSections, initials, MODULE_LABEL, ROLE_TITLE, type NavEntry } from './shellModel';

const ICONS: Record<AppModule, React.ComponentType<{ className?: string }>> = {
  FLOOR: LayoutGrid,
  POS: ShoppingBag,
  KDS: Tv,
  CASHIER: Wallet,
  ERP: BarChart3,
  CATALOG: BookOpen,
  SETTINGS: Settings,
};

const MODULES: AppModule[] = ['FLOOR', 'POS', 'KDS', 'CASHIER', 'ERP', 'CATALOG', 'SETTINGS'];

/** Menü araması üst çubuktaki arama düğmesinden de odaklanabilsin diye kimliği sabittir. */
export const NAV_SEARCH_ID = 'nav-search';

export const SidebarNav: React.FC = () => {
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const user = useAuthStore((state) => state.user);
  const lock = useAuthStore((state) => state.lock);
  const activeKdsCount = useKdsStore((state) => state.tickets.length);
  const isEnabled = useFeatureStore((state) => state.isEnabled);
  const businessName = useSetupStore((state) => state.draft.businessName.trim());
  const [query, setQuery] = useState('');

  // Görünürlük kuralları eski menüyle aynıdır: rol haritası ve özellik bayrağı belirler.
  const sections = useMemo(() => {
    const entries: NavEntry[] = MODULES.map((id) => {
      let visible = canOpenModule(user?.role, id);
      if (id === 'POS') visible = visible && user?.role !== 'WAITER';
      if (id === 'KDS') visible = visible && isEnabled('feat_kds');
      return { id, label: MODULE_LABEL[id], visible, badge: id === 'KDS' && activeKdsCount > 0 ? activeKdsCount : undefined };
    });
    return buildNavSections(entries, query);
  }, [user?.role, isEnabled, activeKdsCount, query]);

  const isDark = theme === 'dark';

  return (
    <aside className="side-rail">
      <div className="side-brand">
        <BrandMark className="side-brand-mark" surface="desk" />
        <div className="side-brand-text">
          <span className="side-brand-name">{businessName || 'KASAM360'}</span>
          {businessName ? <span className="side-brand-sub">KASAM360</span> : null}
        </div>
      </div>

      <label className="side-search" htmlFor={NAV_SEARCH_ID}>
        <Search className="w-4 h-4 shrink-0" aria-hidden />
        <input
          id={NAV_SEARCH_ID}
          type="search"
          value={query}
          placeholder="Menüde ara"
          aria-label="Menüde ara"
          autoComplete="off"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
      </label>

      <nav className="side-nav" aria-label="Ana Menü">
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.title} className="side-group">
            <span className="side-group-title" aria-hidden>{section.title}</span>
            {section.items.map((item) => {
              const Icon = ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className="side-item"
                  aria-current={activeModule === item.id ? 'page' : undefined}
                  onClick={() => setActiveModule(item.id)}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden />
                  <span className="side-item-label">{item.label}</span>
                  {item.badge ? <span className="side-badge">{item.badge}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
        {sections.length === 0 ? <p className="side-empty" role="status">Eşleşen menü yok.</p> : null}
      </nav>

      <div className="side-foot">
        <div className="side-switch-row">
          <span className="side-switch-label">
            {isDark ? <Moon className="w-5 h-5" aria-hidden /> : <Sun className="w-5 h-5" aria-hidden />}
            <span className="side-item-label">Koyu mod</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Koyu mod"
            className="side-switch"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            <span className="side-switch-knob" />
          </button>
        </div>

        {/* Kasada kimin çalıştığı görünür; kilit eylemi kartın üzerindedir. */}
        {user ? (
          <div className="side-user">
            <span className="side-avatar" aria-hidden>{initials(user.name)}</span>
            <span className="side-user-text">
              <span className="side-user-name">{user.name}</span>
              <span className="side-user-role">{ROLE_TITLE[user.role]}</span>
            </span>
            <button type="button" className="side-user-lock" onClick={lock} aria-label="Kilitle" title="Kilitle">
              <Lock className="w-5 h-5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
