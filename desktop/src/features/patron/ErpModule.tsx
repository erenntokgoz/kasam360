// ERP (Yönetim) Ana Modülü
// 48px dokunsal donanım tuşlarıyla üst yatay navigasyon çubuğu ve modül alanları.
// Açık ve koyu tema tam uyumlu, Tactile Matte Hardware estetiği.

import React, { useEffect } from 'react';
import {
  UtensilsCrossed,
  Zap,
  BookOpen,
  Users,
  TrendingUp,
  ArrowLeft,
  CalendarCheck,
  Receipt,
  FileBarChart,
  Gauge,
  Package,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useUIStore } from '../../stores/uiStore';
import { Menu360Module } from '../menu360/Menu360Module';
import { StockHub } from '../stock/StockHub';
import { useAuthStore } from '../../stores/authStore';
import { PatronWizardTab } from './PatronWizardTab';
import { DebtsTab } from './DebtsTab';
import { StaffTab } from './StaffTab';
import { ProfitTab } from './ProfitTab';
import { SessionSettingsTab } from './SessionSettingsTab';
import { CriticalLogTab } from './CriticalLogTab';
import { PanoramaTab } from './panorama/PanoramaTab';
import { ReportsTab } from './reports/ReportsTab';
import { ExpensesTab } from './expenses/ExpensesTab';
import { LeavePanel } from './payroll/LeavePanel';
import { ShiftPlanPanel } from './payroll/ShiftPlanPanel';
import { PayrollPanel } from './payroll/PayrollPanel';

export const ErpModule: React.FC = () => {
  const { activeErpTab, setActiveErpTab, loadLedgerData } = useLedgerStore();
  const { setActiveModule } = useUIStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');

  const activeModule = useUIStore((state) => state.activeModule);

  // Modül açık kalır: satış sonrası rapor eski kalmasın diye her girişte okunur.
  useEffect(() => {
    if (activeModule === 'ERP') void loadLedgerData();
  }, [loadLedgerData, activeModule, activeErpTab]);

  const tabs: Array<{
    id: typeof activeErpTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'PANORAMA', label: 'Panorama', icon: Gauge },
    { id: 'REPORTS', label: 'Raporlar', icon: FileBarChart },
    { id: 'EXPENSES', label: 'Gider', icon: Receipt },
    { id: 'PAYROLL', label: 'Bordro', icon: CalendarCheck },
    { id: 'WIZARD', label: 'Hızlı İşlem', icon: Zap },
    { id: 'DEBTS', label: 'Cari', icon: BookOpen },
    { id: 'STAFF', label: 'Personel', icon: Users },
    { id: 'PROFIT', label: 'Net Kâr', icon: TrendingUp },
    { id: 'MENU', label: 'Menü', icon: UtensilsCrossed },
    ...(isOwner ? [{ id: 'STOCK' as const, label: 'Stok', icon: Package }] : []),
    { id: 'LOG', label: 'Kritik', icon: ShieldAlert },
    { id: 'SETTINGS', label: 'Ayarlar', icon: Settings },
  ];

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      {/* Üst Yatay Donanım Navigasyon Çubuğu (48px Dokunsal Tuşlar) */}
      <header className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <nav className="flex items-center gap-2 overflow-x-auto" aria-label="Yönetim Modülleri">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeErpTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveErpTab(tab.id)}
                className={`tactile-btn min-h-12 px-3 rounded-lg flex items-center gap-2 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[var(--bg-hover)] text-[var(--text-primary)] border-[var(--accent-blue)] shadow-[inset_0_0_0_1px_var(--accent-blue)]'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    isSelected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'
                  }`}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Salona Dön Butonu (48px Dokunsal Tuş) */}
        <button
          type="button"
          onClick={() => setActiveModule('FLOOR')}
          className="tactile-btn min-h-12 px-4 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold border-[var(--border)] flex items-center gap-2 cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Salona Dön</span>
        </button>
      </header>

      {/* Modül İçeriği */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeErpTab === 'MENU' ? <Menu360Module /> : activeErpTab === 'STOCK' && isOwner ? <StockHub /> : (
          <div className="flex-1 overflow-y-auto p-5">
            {activeErpTab === 'PANORAMA' && <PanoramaTab />}
            {activeErpTab === 'REPORTS' && <ReportsTab />}
            {activeErpTab === 'EXPENSES' && <ExpensesTab />}
            {activeErpTab === 'PAYROLL' && (
              <div className="space-y-4 max-w-[1500px] mx-auto">
                <PayrollPanel />
                <LeavePanel />
                <ShiftPlanPanel />
              </div>
            )}
            {activeErpTab === 'WIZARD' && <PatronWizardTab />}
            {activeErpTab === 'DEBTS' && <DebtsTab />}
            {activeErpTab === 'STAFF' && <StaffTab />}
            {activeErpTab === 'PROFIT' && <ProfitTab />}
            {activeErpTab === 'LOG' && <CriticalLogTab />}
            {activeErpTab === 'SETTINGS' && <SessionSettingsTab />}
          </div>
        )}
      </div>
    </section>
  );
};
