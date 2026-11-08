import { useState } from 'react';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { StockWastePanel } from './StockWastePanel';
import { useFeatureStore } from '../../stores/featureStore';
import { StockRecipes } from './StockRecipes';
import { StockOverview } from './StockOverview';
import { StockTrailPanel } from './StockTrailPanel';

const TABS = [
  { id: 'OVERVIEW', label: 'Mevcut Stok' },
  { id: 'RECIPES', label: 'Reçeteler' },
  { id: 'WASTE', label: 'Zayiat ve Fire' },
  { id: 'TRAIL', label: 'Hareketler' },
] as const;

/** Stok girişi, eldeki miktar ve fire tek yerde durur. */
export function StockHub() {
  const recipesEnabled = useFeatureStore((state) => state.flags.feat_recipe_bom);
  const [activeTab, setTab] = useState<(typeof TABS)[number]['id']>('OVERVIEW');

  const tab = activeTab === 'RECIPES' && !recipesEnabled ? 'OVERVIEW' : activeTab;
  const [entry, setEntry] = useState<string | null>(null);

  return (
    <div className="motion-swap flex-1 min-h-0 flex flex-col">
      <Bar label="Stok bölümleri" plain actions={tab === 'OVERVIEW' ?
        <BarAction tone="primary" onClick={() => setEntry('')}>+ Stok Girişi</BarAction> : undefined}>
        {TABS.filter(({ id }) => id !== 'RECIPES' || recipesEnabled).map(({ id, label }) => (
          <BarTab key={id} active={tab === id} onClick={() => setTab(id)}>{label}</BarTab>
        ))}
      </Bar>
      {tab === 'OVERVIEW' ? <StockOverview target={entry} onEntry={setEntry} onCloseEntry={() => setEntry(null)} /> : null}
      {tab === 'RECIPES' ? <StockRecipes /> : null}
      {tab === 'WASTE' ? <StockWastePanel /> : null}
      {tab === 'TRAIL' ? <StockTrailPanel /> : null}
    </div>
  );
}
