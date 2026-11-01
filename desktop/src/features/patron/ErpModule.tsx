// ERP (Yönetim) Ana Modülü
// Üst sekmeler masa üstündedir, içerik kâğıt panellerdir.
// Beş ana bölüm; Raporlar ve Ayarlar ikincil gezinmededir.

import React from 'react';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
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
}

const PRIMARY: NavTab[] = [
  { id: 'PANORAMA', label: 'Genel Bakış' },
  { id: 'FINANCE', label: 'Finans' },
  { id: 'DEBTS', label: 'Cari' },
  { id: 'STAFF', label: 'Personel Defteri' },
  { id: 'CATALOG', label: 'Menü ve Stok' },
];

const SECONDARY: NavTab[] = [
  { id: 'REPORTS', label: 'Raporlar' },
  { id: 'SETTINGS', label: 'Ayarlar' },
];

const NavButton: React.FC<{ tab: NavTab; isSelected: boolean; onSelect: () => void }> = ({ tab, isSelected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-current={isSelected ? 'page' : undefined}
    className="desk-tab text-lg shrink-0"
  >
    {tab.label}
  </button>
);

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab } = useLedgerStore();

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <header className="px-5 pt-3 flex items-center justify-between gap-6 shrink-0 border-b-2 border-[var(--border)] overflow-x-auto">
        <nav className="flex items-center gap-6" aria-label="Yönetim Modülleri">
          {PRIMARY.map((tab) => (
            <NavButton key={tab.id} tab={tab} isSelected={activeErpTab === tab.id} onSelect={() => setActiveErpTab(tab.id)} />
          ))}
        </nav>
        <nav className="flex items-center gap-6" aria-label="İkincil Yönetim">
          {SECONDARY.map((tab) => (
            <NavButton key={tab.id} tab={tab} isSelected={activeErpTab === tab.id} onSelect={() => setActiveErpTab(tab.id)} />
          ))}
        </nav>
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
