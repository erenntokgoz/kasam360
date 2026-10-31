// ERP (Yönetim) Ana Modülü
// 48px dokunsal donanım tuşlarıyla üst yatay navigasyon çubuğu ve modül alanları.
// Beş ana bölüm; Raporlar ve Ayarlar ikincil gezinmededir.

import React from 'react';
import {
  ArrowLeft,
  BookOpen,
  FileBarChart,
  Gauge,
  Settings,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
import { useUIStore } from '../../stores/uiStore';
import { CatalogTab } from './CatalogTab';
import { DebtsTab } from './DebtsTab';
import { FinanceTab } from './finance/FinanceTab';
import { PanoramaTab } from './panorama/PanoramaTab';
import { ReportsTab } from './reports/ReportsTab';
import { SettingsTab } from './settings/SettingsTab';
import { StaffLedger } from './staff/StaffLedger';

interface NavTab {
  id: ErpTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY: NavTab[] = [
  { id: 'PANORAMA', label: 'Genel Bakış', icon: Gauge },
  { id: 'FINANCE', label: 'Finans', icon: Wallet },
  { id: 'DEBTS', label: 'Cari', icon: BookOpen },
  { id: 'STAFF', label: 'Personel Defteri', icon: Users },
  { id: 'CATALOG', label: 'Menü ve Stok', icon: UtensilsCrossed },
];

const SECONDARY: NavTab[] = [
  { id: 'REPORTS', label: 'Raporlar', icon: FileBarChart },
  { id: 'SETTINGS', label: 'Ayarlar', icon: Settings },
];

const NavButton: React.FC<{ tab: NavTab; isSelected: boolean; onSelect: () => void }> = ({ tab, isSelected, onSelect }) => {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'page' : undefined}
      className={`tactile-btn min-h-12 px-3 rounded-lg flex items-center gap-2 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
          : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <Icon className={`w-4 h-4 ${isSelected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'}`} />
      <span>{tab.label}</span>
    </button>
  );
};

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab } = useLedgerStore();
  const { setActiveModule } = useUIStore();

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <header className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <nav className="flex items-center gap-2 overflow-x-auto" aria-label="Yönetim Modülleri">
          {PRIMARY.map((tab) => (
            <NavButton key={tab.id} tab={tab} isSelected={activeErpTab === tab.id} onSelect={() => setActiveErpTab(tab.id)} />
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <nav className="flex items-center gap-2" aria-label="İkincil Yönetim">
            {SECONDARY.map((tab) => (
              <NavButton key={tab.id} tab={tab} isSelected={activeErpTab === tab.id} onSelect={() => setActiveErpTab(tab.id)} />
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setActiveModule('FLOOR')}
            className="tactile-btn min-h-12 px-4 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold border-[var(--border)] flex items-center gap-2 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Salona Dön</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeErpTab === 'CATALOG' ? <CatalogTab /> : (
          <div className="flex-1 overflow-y-auto p-5">
            {activeErpTab === 'PANORAMA' && <PanoramaTab />}
            {activeErpTab === 'FINANCE' && <FinanceTab />}
            {activeErpTab === 'DEBTS' && <DebtsTab />}
            {activeErpTab === 'STAFF' && <StaffLedger />}
            {activeErpTab === 'REPORTS' && <ReportsTab />}
            {activeErpTab === 'SETTINGS' && <SettingsTab />}
          </div>
        )}
      </div>
    </section>
  );
};
