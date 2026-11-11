// ERP (Yönetim) Ana Modülü
// Üst şerit ve modül alanları.

import React from 'react';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
import { Bar, BarTab } from '../../ui/Bar';
import { CriticalLogTab } from './CriticalLogTab';
import { DebtsTab } from './DebtsTab';
import { PanoramaTab } from './panorama/PanoramaTab';
import { StaffLedger } from './staff/StaffLedger';

const TABS: { id: ErpTab; label: string }[] = [
  { id: 'PANORAMA', label: 'Genel Bakış' },
  { id: 'DEBTS', label: 'Cari' },
  { id: 'STAFF', label: 'Personel' },
  { id: 'AUDIT', label: 'Kritik Kayıtlar' },
];

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab } = useLedgerStore();
  const section = TABS.some(({ id }) => id === activeErpTab) ? activeErpTab : 'PANORAMA';

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      <Bar label="Yönetim" title="Yönetim">
        {TABS.map((tab) => (
          <BarTab key={tab.id} id={`erp-tab-${tab.id}`} aria-controls="erp-content"
            active={section === tab.id} onClick={() => setActiveErpTab(tab.id)}>
            {tab.label}
          </BarTab>
        ))}
      </Bar>

      <div id="erp-content" role="tabpanel" aria-labelledby={`erp-tab-${section}`}
        className="motion-swap page-fill flex-1 min-h-0 overflow-y-auto p-4">
        {section === 'PANORAMA' && <PanoramaTab />}
        {section === 'DEBTS' && <DebtsTab />}
        {section === 'STAFF' && <StaffLedger />}
        {section === 'AUDIT' && <CriticalLogTab />}
      </div>
    </section>
  );
};
