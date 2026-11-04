import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { BackupPanel } from '../BackupPanel';
import type { SectionTab } from '../SectionTabs';
import { SessionSettingsTab } from '../SessionSettingsTab';
import { LegacyArchivePanel } from './LegacyArchivePanel';
import { StationSettings } from './StationSettings';
import { TablesSettings } from './TablesSettings';

type SettingsSection = 'SESSION' | 'FLOOR' | 'BACKUP';

/** Sol menüdeki Ayarlar: işletme, salon ve yedek. */
export const SettingsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<SettingsSection>('SESSION');

  useEffect(() => {
    if (erpSection === 'BACKUP' && isOwner) setSection('BACKUP');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<SettingsSection>[] = [
    { id: 'SESSION', label: 'İşletme' },
    { id: 'FLOOR', label: 'Salon' },
    ...(isOwner ? [{ id: 'BACKUP' as const, label: 'Yedek' }] : []),
  ];

  return (
    <section className="flex-1 flex min-w-0 h-full overflow-hidden select-none text-[var(--text-primary)]">
      <nav aria-label="Ayarlar" className="paper shrink-0 w-48 flex flex-col gap-1 p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={section === tab.id ? 'page' : undefined}
            className={`min-h-12 px-3 rounded text-left font-bold ${section === tab.id ? 'bg-[var(--marker)]' : ''}`}
            onClick={() => setSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <p className="mt-auto p-2 text-sm text-[var(--text-muted)]">KASAM360 {__APP_VERSION__}</p>
      </nav>
      <div className="page-fill flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
        {section === 'SESSION' ? (
          <div className="space-y-4">
            <SessionSettingsTab />
          </div>
        ) : null}
        {section === 'FLOOR' ? (
          <div className="space-y-4">
            <TablesSettings />
            <StationSettings />
          </div>
        ) : null}
        {section === 'BACKUP' ? (
          <div className="space-y-4">
            <BackupPanel />
            <LegacyArchivePanel />
          </div>
        ) : null}
      </div>
    </section>
  );
};
