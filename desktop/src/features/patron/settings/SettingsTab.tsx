import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { SyncDevicesModal } from '../../shell/SyncDevicesModal';
import { Button } from '../../../ui/Button';
import { ApprovalGrantsPanel } from '../ApprovalGrantsPanel';
import { BackupPanel } from '../BackupPanel';
import { CriticalLogTab } from '../CriticalLogTab';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { SessionSettingsTab } from '../SessionSettingsTab';
import { LegacyArchivePanel } from './LegacyArchivePanel';
import { TestPosPanel } from './TestPosPanel';

type SettingsSection = 'SESSION' | 'GRANTS' | 'DEVICES' | 'BACKUP' | 'POS' | 'AUDIT';

/** Oturum, yetki, cihaz, yedek ve kritik kayıtlar. Patrona özel sayfalar müdürde görünmez. */
export const SettingsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<SettingsSection>('SESSION');
  const [devicesOpen, setDevicesOpen] = useState(false);

  useEffect(() => {
    if (erpSection === 'AUDIT') setSection('AUDIT');
    if (erpSection === 'BACKUP' && isOwner) setSection('BACKUP');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<SettingsSection>[] = [
    { id: 'SESSION', label: 'Oturum' },
    ...(isOwner ? [{ id: 'GRANTS' as const, label: 'Yetki' }] : []),
    { id: 'DEVICES', label: 'Cihazlar' },
    ...(isOwner ? [{ id: 'BACKUP' as const, label: 'Yedek' }] : []),
    ...(isOwner ? [{ id: 'POS' as const, label: 'Test POS' }] : []),
    { id: 'AUDIT', label: 'Kritik Kayıtlar' },
  ];

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto">
      <SectionTabs label="Ayarlar" tabs={tabs} active={section} onChange={setSection} />
      {section === 'SESSION' ? <SessionSettingsTab /> : null}
      {section === 'GRANTS' ? <ApprovalGrantsPanel /> : null}
      {section === 'DEVICES' ? (
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-2 max-w-xl">
          <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Bağlı Cihazlar</h3>
          <p className="text-xs text-[var(--text-secondary)]">Eşleştirme, pasife alma ve cihaz devralma buradan yapılır.</p>
          <Button variant="secondary" className="min-h-12 text-xs" onClick={() => setDevicesOpen(true)}>Cihazları Yönet</Button>
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
  );
};
