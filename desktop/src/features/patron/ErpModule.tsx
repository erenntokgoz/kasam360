// ERP (Yönetim) Ana Modülü
// Üst şerit ve modül alanları.

import React from 'react';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
import { Bar, BarTab } from '../../ui/Bar';
import { CriticalLogTab } from './CriticalLogTab';
import { TariffPanel } from '../menu/TariffPanel';
import { DebtsTab } from './DebtsTab';
import { PanoramaTab } from './panorama/PanoramaTab';
import { StaffLedger } from './staff/StaffLedger';

const TABS: { id: ErpTab; label: string }[] = [
  { id: 'PANORAMA', label: 'Genel Bakış' },
  { id: 'DEBTS', label: 'Cari' },
  { id: 'STAFF', label: 'Personel' },
  { id: 'TARIFF', label: 'Tarifeler' },
  { id: 'AUDIT', label: 'Kritik Kayıtlar' },
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
        <div className="page-fill flex-1 overflow-y-auto p-4">
            {activeErpTab === 'PANORAMA' && <PanoramaTab />}
            {activeErpTab === 'DEBTS' && <DebtsTab />}
            {activeErpTab === 'STAFF' && <StaffLedger />}
            {activeErpTab === 'TARIFF' && <TariffPanel />}
            {activeErpTab === 'AUDIT' && <CriticalLogTab />}
        </div>
      </div>
    </section>
  );
};
