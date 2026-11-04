import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { MenuModule } from '../menu/MenuModule';
import { StockHub } from '../stock/StockHub';
import { BarTab } from '../../ui/Bar';
import { SectionTabs, type SectionTab } from './SectionTabs';

type CatalogSection = 'MENU' | 'STOCK';

/** Menü, stok ve menünün dışarı verilen dosyası tek bölümdedir. Stok yalnız patronda. */
export const CatalogTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<CatalogSection>('MENU');

  useEffect(() => {
    if (erpSection === 'STOCK' && isOwner) setSection('STOCK');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<CatalogSection>[] = [
    { id: 'MENU', label: 'Menü' },
    ...(isOwner ? [{ id: 'STOCK' as const, label: 'Stok' }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {section === 'MENU' ? (
        <MenuModule
          tabs={tabs.map((tab) => (
            <BarTab key={tab.id} active={section === tab.id} onClick={() => setSection(tab.id)}>{tab.label}</BarTab>
          ))}
        />
      ) : (
        <div className="shrink-0">
          <SectionTabs label="Menü ve Stok" tabs={tabs} active={section} onChange={setSection} />
        </div>
      )}
      {section === 'STOCK' ? <StockHub /> : null}
    </div>
  );
};
