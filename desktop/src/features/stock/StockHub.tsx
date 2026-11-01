import { useState } from 'react';
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
      <nav className="flex gap-6 px-5" aria-label="Stok bölümleri">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => setTab(id)} className="desk-tab" aria-pressed={tab === id}>
            {label}
          </button>
        ))}
      </nav>
      <div className="paper flex-1 min-h-0 flex flex-col overflow-hidden mx-5 mb-5">
        {tab === 'OVERVIEW' ? <StockOverview /> : null}
        {tab === 'PURCHASE' ? <StockModule /> : null}
        {tab === 'COUNT' ? <StockCountPanel /> : null}
        {tab === 'TRAIL' ? <StockTrailPanel /> : null}
      </div>
    </div>
  );
}
