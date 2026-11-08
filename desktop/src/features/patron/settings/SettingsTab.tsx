import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { BackupPanel } from '../BackupPanel';
import { Bar, BarTab } from '../../../ui/Bar';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { CloudSyncSettings } from './CloudSyncSettings';
import { DeviceSettings } from './DeviceSettings';
import { LicenseSettings } from './LicenseSettings';
import { SessionSettingsTab } from '../SessionSettingsTab';
import { LegacyArchivePanel } from './LegacyArchivePanel';
import { StationSettings } from './StationSettings';
import { TablesSettings } from './TablesSettings';

type SettingsSection = 'SESSION' | 'FLOOR' | 'BACKUP';

/** Sol menüdeki Ayarlar: işletme, salon ve yedek. */
export const SettingsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [floorSection, setFloorSection] = useState<'TABLES' | 'STATIONS' | 'RESERVATIONS'>('TABLES');
  const [deviceSection, setDeviceSection] = useState<'ACCOUNT' | 'DEVICES'>('ACCOUNT');
  const [section, setSection] = useState<SettingsSection>('SESSION');

  useEffect(() => {
    if (erpSection === 'BACKUP' && isOwner) setSection('BACKUP');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<SettingsSection>[] = [
    { id: 'SESSION', label: 'Bu Cihaz' },
    { id: 'FLOOR', label: 'Salon ve Mutfak' },
    ...(isOwner ? [{ id: 'BACKUP' as const, label: 'Yedek ve Kurtarma' }] : []),
  ];

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden text-[var(--text-primary)]">
      <Bar label="Ayarlar" actions={<span className="px-2 text-xs text-[var(--text-secondary)]">KASAM360 {__APP_VERSION__}</span>}>
        {tabs.map((tab) => (
          <BarTab key={tab.id} active={section === tab.id} onClick={() => setSection(tab.id)}>{tab.label}</BarTab>
        ))}
      </Bar>
      <div className="motion-swap page-fill flex-1 overflow-y-auto p-4 space-y-4">
        {section === 'SESSION' ? (
          <>
            <SectionTabs label="Bu Cihaz" active={deviceSection} onChange={setDeviceSection}
              tabs={[{ id: 'ACCOUNT', label: 'Oturum ve Görünüm' }, { id: 'DEVICES', label: 'Cihaz Bağlantıları' }]} />
            {deviceSection === 'ACCOUNT' ? <SessionSettingsTab /> : <><LicenseSettings /><DeviceSettings canManage={isOwner} /><CloudSyncSettings canManage={isOwner} /></>}
          </>
        ) : null}
        {section === 'FLOOR' ? (
          <>
            <SectionTabs label="Salon ve Mutfak" active={floorSection} onChange={setFloorSection}
              tabs={[{ id: 'TABLES', label: 'Masalar ve Kroki' }, { id: 'STATIONS', label: 'Mutfak İstasyonları' }, { id: 'RESERVATIONS', label: 'Rezervasyon' }]} />
            {floorSection === 'TABLES' ? <TablesSettings /> : null}
            {floorSection === 'STATIONS' ? <StationSettings /> : null}
            {floorSection === 'RESERVATIONS' ? <SessionSettingsTab reservations /> : null}
          </>
        ) : null}
        {section === 'BACKUP' && isOwner ? (
          <>
            <BackupPanel />
            <LegacyArchivePanel />
          </>
        ) : null}
      </div>
    </section>
  );
};
