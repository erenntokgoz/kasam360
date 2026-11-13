import { useLedgerStore } from '../../../stores/ledgerStore';
import { ProfitSection } from '../finance/ProfitSection';
import { DayCloseArchive } from '../reports/DayCloseArchive';
import { ReportsTab } from '../reports/ReportsTab';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { BoardSection } from './BoardSection';

type OverviewSection = 'BOARD' | 'PROFIT' | 'REPORTS' | 'DAY_CLOSES';

const SECTIONS: SectionTab<OverviewSection>[] = [
  { id: 'BOARD', label: 'Pano' },
  { id: 'PROFIT', label: 'Kâr ve Sabit Gider' },
  { id: 'REPORTS', label: 'Raporlar' },
  { id: 'DAY_CLOSES', label: 'Gün Sonları' },
];

/** Alt bölümler aynı çubukta durur ve açık sayfa gezinmede görünür. */
export function PanoramaTab() {
  const erpSection = useLedgerStore((state) => state.erpSection);
  const setActiveErpTab = useLedgerStore((state) => state.setActiveErpTab);
  const section = erpSection === 'PROFIT' || erpSection === 'REPORTS' || erpSection === 'DAY_CLOSES' ? erpSection : 'BOARD';

  return (
    <div className="space-y-4">
      <SectionTabs label="Genel Bakış bölümleri" tabs={SECTIONS} active={section}
        onChange={(next) => setActiveErpTab('PANORAMA', next === 'BOARD' ? null : next)} />
      {section === 'BOARD' ? <BoardSection /> : null}
      {section === 'PROFIT' ? <ProfitSection /> : null}
      {section === 'REPORTS' ? <ReportsTab /> : null}
      {section === 'DAY_CLOSES' ? <DayCloseArchive /> : null}
    </div>
  );
}
