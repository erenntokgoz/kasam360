import React, { useEffect, useState } from 'react';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { ProfitSection } from '../finance/ProfitSection';
import { ReportsTab } from '../reports/ReportsTab';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { BoardSection } from './BoardSection';

type OverviewSection = 'BOARD' | 'PROFIT' | 'REPORTS';

const SECTIONS: SectionTab<OverviewSection>[] = [
  { id: 'BOARD', label: 'Pano' },
  { id: 'PROFIT', label: 'Kâr ve Sabit Gider' },
  { id: 'REPORTS', label: 'Raporlar' },
];

const isSection = (value: string | null): value is OverviewSection =>
  SECTIONS.some((item) => item.id === value);

/** Genel Bakış: pano, aylık kâr ve raporlar aynı yerde; ayrı sekmeler dağınık kalıyordu. */
export const PanoramaTab: React.FC = () => {
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<OverviewSection>(isSection(erpSection) ? erpSection : 'BOARD');

  useEffect(() => {
    if (isSection(erpSection)) setSection(erpSection);
  }, [erpSection]);

  return (
    <div className="space-y-4">
      <SectionTabs label="Genel Bakış" tabs={SECTIONS} active={section} onChange={setSection} />
      {section === 'BOARD' ? <BoardSection /> : null}
      {section === 'PROFIT' ? <ProfitSection /> : null}
      {section === 'REPORTS' ? <ReportsTab /> : null}
    </div>
  );
};
