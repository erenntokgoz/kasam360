import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useMenu360Store } from '../../stores/menu360Store';
import { Menu360Module } from '../menu360/Menu360Module';
import { TariffPanel } from '../menu360/TariffPanel';
import { StockHub } from '../stock/StockHub';
import { QrMenuPanel } from './QrMenuPanel';
import { SectionTabs, type SectionTab } from './SectionTabs';

type CatalogSection = 'MENU' | 'PRICES' | 'TARIFF' | 'STOCK' | 'QR';

/** Menü, stok ve menünün dışarı verilen dosyası tek bölümdedir. Stok yalnız patronda. */
export const CatalogTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const hasQr = useAuthStore((state) => state.user?.activeModules?.includes('feat_qr_menu') ?? false);
  const erpSection = useLedgerStore((state) => state.erpSection);
  const setMenuTab = useMenu360Store((state) => state.setActiveTab);
  const [section, setSection] = useState<CatalogSection>('MENU');

  useEffect(() => {
    if (erpSection === 'STOCK' && isOwner) setSection('STOCK');
  }, [erpSection, isOwner]);

  const tabs: SectionTab<CatalogSection>[] = [
    { id: 'MENU', label: 'Menü' },
    { id: 'PRICES', label: 'Fiyatlar ve Toplu Zam' },
    { id: 'TARIFF', label: 'Tarifeler' },
    ...(isOwner ? [{ id: 'STOCK' as const, label: 'Stok' }] : []),
    ...(hasQr ? [{ id: 'QR' as const, label: 'QR Menü Dosyası' }] : []),
  ];

  const openSection = (next: CatalogSection) => {
    if (next === 'MENU') setMenuTab('KATALOG');
    if (next === 'PRICES') setMenuTab('FIYATLAR');
    setSection(next);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 pt-3 shrink-0">
        <SectionTabs label="Menü ve Stok" tabs={tabs} active={section} onChange={openSection} />
      </div>
      {section === 'MENU' || section === 'PRICES' ? <Menu360Module /> : null}
      {section === 'TARIFF' ? <div className="paper flex-1 min-h-0 overflow-y-auto m-5"><TariffPanel /></div> : null}
      {section === 'STOCK' ? <StockHub /> : null}
      {section === 'QR' ? <div className="p-5"><QrMenuPanel /></div> : null}
    </div>
  );
};
