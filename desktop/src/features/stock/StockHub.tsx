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
      <nav className="flex gap-2 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2" aria-label="Stok bölümleri">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`tactile-btn min-h-12 rounded-lg px-4 text-xs font-bold ${
              tab === id
                ? 'bg-[var(--brand)] text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'OVERVIEW' ? <StockOverview /> : null}
      {tab === 'PURCHASE' ? <StockModule /> : null}
      {tab === 'COUNT' ? <StockCountPanel /> : null}
      {tab === 'TRAIL' ? <StockTrailPanel /> : null}
    </div>
  );
}
