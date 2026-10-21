import React, { useEffect } from 'react';
import { ArrowLeft, Zap, BookOpen, Users, TrendingUp } from 'lucide-react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { PatronWizardTab } from './PatronWizardTab';
import { DebtsTab } from './DebtsTab';
import { StaffTab } from './StaffTab';
import { ProfitTab } from './ProfitTab';

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab, loadLedgerData } = useLedgerStore();
  const { setActiveModule } = useUIStore();

  useEffect(() => {
    loadLedgerData();
  }, [loadLedgerData]);

  const tabs: Array<{
    id: typeof activeErpTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'WIZARD', label: 'Hızlı Kasa İşlemi', icon: Zap },
    { id: 'DEBTS', label: 'Borç & Alacak Defteri', icon: BookOpen },
    { id: 'STAFF', label: 'Personel & Avans', icon: Users },
    { id: 'PROFIT', label: 'Kasa & Net Kâr (FIFO)', icon: TrendingUp },
  ];

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      {/* Üst Bar */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeErpTab === tab.id;
            return (
              <Button
                key={tab.id}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setActiveErpTab(tab.id)}
                className="!min-h-[38px] text-xs font-bold"
              >
                <Icon className="w-3.5 h-3.5 mr-1" />
                <span>{tab.label}</span>
              </Button>
            );
          })}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActiveModule('FLOOR')}
          className="!min-h-[38px] text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          <span>Salona Dön</span>
        </Button>
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeErpTab === 'WIZARD' && <PatronWizardTab />}
        {activeErpTab === 'DEBTS' && <DebtsTab />}
        {activeErpTab === 'STAFF' && <StaffTab />}
        {activeErpTab === 'PROFIT' && <ProfitTab />}
      </div>
    </section>
  );
};
