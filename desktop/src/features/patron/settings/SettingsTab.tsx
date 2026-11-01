import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useKdsStore } from '../../../stores/kdsStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { SyncDevicesModal } from '../../shell/SyncDevicesModal';
import { Bar, BarTab } from '../../../ui/Bar';
import { Button } from '../../../ui/Button';
import { ApprovalGrantsPanel } from '../ApprovalGrantsPanel';
import { BackupPanel } from '../BackupPanel';
import { CriticalLogTab } from '../CriticalLogTab';
import type { SectionTab } from '../SectionTabs';
import { SessionSettingsTab } from '../SessionSettingsTab';
import { LegacyArchivePanel } from './LegacyArchivePanel';
import { TestPosPanel } from './TestPosPanel';

type SettingsSection = 'SESSION' | 'GRANTS' | 'DEVICES' | 'BACKUP' | 'POS' | 'AUDIT';

/** Sol menüdeki Ayarlar: oturum, yetki, cihaz, yedek ve kritik kayıtlar. */
export const SettingsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<SettingsSection>('SESSION');
  const [devicesOpen, setDevicesOpen] = useState(false);
  const playOrderBell = useKdsStore((state) => state.playOrderBell);

  useEffect(() => {
    if (erpSection === 'AUDIT') setSection('AUDIT');
    if (erpSection === 'BACKUP' && isOwner) setSection('BACKUP');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<SettingsSection>[] = [
    { id: 'SESSION', label: 'Genel' },
    ...(isOwner ? [{ id: 'GRANTS' as const, label: 'Yetki' }] : []),
    { id: 'DEVICES', label: 'Cihazlar' },
    ...(isOwner ? [{ id: 'BACKUP' as const, label: 'Yedek' }] : []),
    ...(isOwner ? [{ id: 'POS' as const, label: 'Test POS' }] : []),
    { id: 'AUDIT', label: 'Kritik Kayıtlar' },
  ];

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden select-none text-[var(--text-primary)]">
      <Bar label="Ayarlar">
        {tabs.map((tab) => (
          <BarTab key={tab.id} active={section === tab.id} onClick={() => setSection(tab.id)}>{tab.label}</BarTab>
        ))}
      </Bar>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {section === 'SESSION' ? <SessionSettingsTab /> : null}
        {section === 'GRANTS' ? <ApprovalGrantsPanel /> : null}
        {section === 'DEVICES' ? (
          <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h3 className="print-title text-[var(--text-primary)]">Bağlı Cihazlar</h3>
            <p className="text-xs text-[var(--text-secondary)]">Eşleştirme, pasife alma ve cihaz devralma buradan yapılır.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDevicesOpen(true)}>Cihazları Yönet</Button>
              <Button variant="secondary" onClick={playOrderBell}>Mutfak Zilini Dene</Button>
            </div>
            <SyncDevicesModal isOpen={devicesOpen} onClose={() => setDevicesOpen(false)} />
          </section>
        ) : null}
        {section === 'BACKUP' ? (
          <div className="space-y-4">
            <BackupPanel />
            <LegacyArchivePanel />
          </div>
        ) : null}
        {section === 'POS' ? <TestPosPanel /> : null}
        {section === 'AUDIT' ? <CriticalLogTab /> : null}
      </div>
    </section>
  );
};
