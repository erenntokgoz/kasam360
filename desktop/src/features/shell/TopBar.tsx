import React, { useEffect, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useShiftStore } from '../../stores/shiftStore';
import { useLedgerStore, type ErpTab } from '../../stores/ledgerStore';
import { useSetupStore } from '../../stores/setupStore';
import { canOpenModule } from '../../lib/roleAccess';
import { NAV_SEARCH_ID } from './SidebarNav';
import { SyncStatusChip } from './SyncStatusChip';
import { firstName, greetingFor, longDate, MODULE_LABEL } from './shellModel';

const ERP_TAB_LABEL: Partial<Record<ErpTab, string>> = {
  PANORAMA: 'Genel Bakış',
  DEBTS: 'Cari',
  STAFF: 'Personel',
  AUDIT: 'Kritik Kayıtlar',
};

const MINUTE_MS = 60_000;

/** Üst çubuk: karşılama, nerede olduğunu söyleyen alt satır ve global eylemler. */
export const TopBar: React.FC = () => {
  const activeModule = useUIStore((state) => state.activeModule);
  const openModal = useUIStore((state) => state.openModal);
  const user = useAuthStore((state) => state.user);
  const isShiftOpen = useShiftStore((state) => state.activeShift?.isOpen ?? false);
  const erpTab = useLedgerStore((state) => state.activeErpTab);
  const businessName = useSetupStore((state) => state.draft.businessName.trim());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const screen = activeModule === 'ERP' ? `${MODULE_LABEL.ERP} / ${ERP_TAB_LABEL[erpTab] ?? 'Genel Bakış'}` : MODULE_LABEL[activeModule];
  const subline = [longDate(now), businessName, screen].filter(Boolean).join(' · ');
  // Vardiyayı yalnız kasaya girebilen açar; mutfağa ve garsona gösterilmez.
  const needsShift = !isShiftOpen && canOpenModule(user?.role, 'CASHIER');

  return (
    <header className="app-topbar">
      <div className="top-title">
        <h1 className="top-greeting">{greetingFor(now)}, {firstName(user?.name)}</h1>
        <p className="top-sub">{subline}</p>
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="top-round top-search"
          aria-label="Menüde ara"
          title="Menüde ara"
          onClick={() => document.getElementById(NAV_SEARCH_ID)?.focus()}
        >
          <Search className="w-5 h-5" aria-hidden />
        </button>
        <SyncStatusChip />
        {/* Ekranın birincil eylemi için yuva: şimdilik açık vardiya yoksa vardiya açma. */}
        {needsShift ? (
          <button type="button" className="top-primary" onClick={() => openModal('shiftGate')}>
            <Play className="w-5 h-5" aria-hidden />
            Vardiyayı aç
          </button>
        ) : null}
      </div>
    </header>
  );
};
