import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { Menu360Module } from '../menu360/Menu360Module';
import { TariffPanel } from '../menu360/TariffPanel';
import { StockHub } from '../stock/StockHub';
import { QrMenuPanel } from './QrMenuPanel';
import { SectionTabs, type SectionTab } from './SectionTabs';

type CatalogSection = 'MENU' | 'TARIFF' | 'STOCK' | 'QR';

/** Menü, stok ve menünün dışarı verilen dosyası tek bölümdedir. Stok yalnız patronda. */
export const CatalogTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const hasQr = useAuthStore((state) => state.user?.activeModules?.includes('feat_qr_menu') ?? false);
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<CatalogSection>('MENU');

  useEffect(() => {
    if (erpSection === 'STOCK' && isOwner) setSection('STOCK');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<CatalogSection>[] = [
    { id: 'MENU', label: 'Menü' },
    { id: 'TARIFF', label: 'Tarifeler' },
    ...(isOwner ? [{ id: 'STOCK' as const, label: 'Stok' }] : []),
    ...(hasQr ? [{ id: 'QR' as const, label: 'QR Menü Dosyası' }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0">
        <SectionTabs label="Menü ve Stok" tabs={tabs} active={section} onChange={setSection} />
      </div>
      {section === 'MENU' ? <Menu360Module /> : null}
      {section === 'TARIFF' ? <TariffPanel /> : null}
      {section === 'STOCK' ? <StockHub /> : null}
      {section === 'QR' ? <div className="p-4"><QrMenuPanel /></div> : null}
    </div>
  );
};
