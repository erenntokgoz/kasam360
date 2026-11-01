import { useState } from 'react';
import { Bar, BarTab } from '../../ui/Bar';
import { StockCountPanel } from './StockCountPanel';
import { StockModule } from './StockModule';
import { StockOverview } from './StockOverview';
import { StockTrailPanel } from './StockTrailPanel';

const TABS = [
  { id: 'OVERVIEW', label: 'Mevcut Stok' },
  { id: 'PURCHASE', label: 'Satın Alma' },
  { id: 'COUNT', label: 'Sayım ve Fire' },
  { id: 'TRAIL', label: 'Hareketler' },
] as const;

/** Stok girişi, eldeki miktar, sayım ve fire tek yerde durur. */
export function StockHub() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('OVERVIEW');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Bar label="Stok bölümleri" plain>
        {TABS.map(({ id, label }) => (
          <BarTab key={id} active={tab === id} onClick={() => setTab(id)}>{label}</BarTab>
        ))}
      </Bar>
      {tab === 'OVERVIEW' ? <StockOverview /> : null}
      {tab === 'PURCHASE' ? <StockModule /> : null}
      {tab === 'COUNT' ? <StockCountPanel /> : null}
      {tab === 'TRAIL' ? <StockTrailPanel /> : null}
    </div>
  );
}
