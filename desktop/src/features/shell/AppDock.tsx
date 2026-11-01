import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useFeatureStore } from '../../stores/featureStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useShiftStore } from '../../stores/shiftStore';
import { useUIStore, type AppModule } from '../../stores/uiStore';
import { canOpenModule } from '../../lib/roleAccess';
import { SyncStatusChip } from './SyncStatusChip';

const MODULES: Array<{ id: AppModule; label: string; key: string }> = [
  { id: 'FLOOR', label: 'Salon', key: 'F1' },
  { id: 'POS', label: 'Sipariş', key: 'F2' },
  { id: 'KDS', label: 'Mutfak', key: 'F3' },
  { id: 'CASHIER', label: 'Kasa', key: 'F4' },
  { id: 'ERP', label: 'Yönetim', key: 'F5' },
];

/** Bütün gezinme ve durum tek şeritte: içerik ekranın kalanını kullanır. */
export const AppDock: React.FC = () => {
  const activeModule = useUIStore((state) => state.activeModule);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const openModal = useUIStore((state) => state.openModal);
  const user = useAuthStore((state) => state.user);
  const lock = useAuthStore((state) => state.lock);
  const isShiftOpen = useShiftStore((state) => Boolean(state.activeShift?.isOpen));
  const waiting = useKdsStore((state) => state.tickets.filter((ticket) => !ticket.isCompleted).length);
  const isEnabled = useFeatureStore((state) => state.isEnabled);

  const visible = MODULES.filter(
    (module) =>
      canOpenModule(user?.role, module.id) && (module.id !== 'KDS' || isEnabled('feat_kds')),
  );

  return (
    <nav
      aria-label="Ana Menü"
      className="shrink-0 flex items-stretch gap-1 px-3 border-t-2 border-[var(--border)] bg-[var(--bg-canvas)]"
    >
      {visible.map((module) => (
        <button
          key={module.id}
          type="button"
          className="dock-tab"
          aria-current={activeModule === module.id ? 'page' : undefined}
          onClick={() => setActiveModule(module.id)}
        >
          <span>{module.label}</span>
          {module.id === 'KDS' && waiting > 0 ? <span className="tabular-nums">({waiting})</span> : null}
          <kbd className="kbd-badge">{module.key}</kbd>
        </button>
      ))}

      <div className="ml-auto flex items-center gap-3 text-sm whitespace-nowrap shrink-0">
        <SyncStatusChip />
        <button
          type="button"
          onClick={() => {
            if (!isShiftOpen) openModal('shiftGate');
          }}
          className={`min-h-12 px-2 font-bold cursor-pointer ${
            isShiftOpen ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-amber)]'
          }`}
        >
          {isShiftOpen ? 'Vardiya açık' : 'Vardiya kapalı'}
        </button>
        <span className="hidden xl:inline font-semibold text-[var(--text-secondary)] max-w-40 truncate">{user?.name}</span>
        <button
          type="button"
          onClick={lock}
          className="tactile-btn min-h-12 px-4 rounded-md font-bold cursor-pointer bg-[var(--bg-card)] border-[var(--border-strong)]"
        >
          Kilitle
        </button>
      </div>
    </nav>
  );
};
