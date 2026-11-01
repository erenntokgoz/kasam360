// ERP (Yönetim) Ana Modülü
// Üst şerit ve modül alanları.

import React from 'react';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
import { Bar, BarTab } from '../../ui/Bar';
import { CatalogTab } from './CatalogTab';
import { DebtsTab } from './DebtsTab';
import { FinanceTab } from './finance/FinanceTab';
import { PanoramaTab } from './panorama/PanoramaTab';
import { ReportsTab } from './reports/ReportsTab';
import { StaffLedger } from './staff/StaffLedger';

const TABS: { id: ErpTab; label: string }[] = [
  { id: 'PANORAMA', label: 'Genel Bakış' },
  { id: 'FINANCE', label: 'Finans' },
  { id: 'DEBTS', label: 'Cari' },
  { id: 'STAFF', label: 'Personel' },
  { id: 'CATALOG', label: 'Menü ve Stok' },
  { id: 'REPORTS', label: 'Raporlar' },
];

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab } = useLedgerStore();

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <Bar label="Yönetim">
        {TABS.map((tab) => (
          <BarTab key={tab.id} active={activeErpTab === tab.id} onClick={() => setActiveErpTab(tab.id)}>
            {tab.label}
          </BarTab>
        ))}
      </Bar>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeErpTab === 'CATALOG' ? <CatalogTab /> : (
          <div className="flex-1 overflow-y-auto p-4">
            {activeErpTab === 'PANORAMA' && <PanoramaTab />}
            {activeErpTab === 'FINANCE' && <FinanceTab />}
            {activeErpTab === 'DEBTS' && <DebtsTab />}
            {activeErpTab === 'STAFF' && <StaffLedger />}
            {activeErpTab === 'REPORTS' && <ReportsTab />}
          </div>
        )}
      </div>
    </section>
  );
};
