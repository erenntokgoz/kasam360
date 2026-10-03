// Faz 12 · Envanter 360 konteyneri.
//
// Beş panel bir sekme kapsülünde toplanır: fiyat, reçete, tedarikçi, raf ömrü,
// fire & sayım. Her panel kendi bayrağını ve rol kapısını taşır; konteyner
// yalnız geçişi yönetir.

import { useState } from 'react';
import { ChefHat, ClipboardList, Snowflake, Truck } from 'lucide-react';
import { PricingPanel } from './PricingPanel';
import { RecipePanel } from './RecipePanel';
import { ShelfLifePanel } from './ShelfLifePanel';
import { SupplierPanel } from './SupplierPanel';
import { WasteCountPanel } from './WasteCountPanel';

type PanelId = 'FIYAT' | 'RECETE' | 'TEDARIKCI' | 'RAF' | 'FIRE';

const PANELLER: ReadonlyArray<{ id: PanelId; label: string; icon: React.ReactNode }> = [
  { id: 'FIYAT', label: 'Fiyat', icon: <Snowflake size={14} /> },
  { id: 'RECETE', label: 'Reçete', icon: <ChefHat size={14} /> },
  { id: 'TEDARIKCI', label: 'Tedarikçi', icon: <Truck size={14} /> },
  { id: 'RAF', label: 'Raf ömrü', icon: <ClipboardList size={14} /> },
  { id: 'FIRE', label: 'Fire & Sayım', icon: <ClipboardList size={14} /> },
];

export function Inventory360Tab() {
  const [panel, setPanel] = useState<PanelId>('FIYAT');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg">
        <div>
          <div className="flex items-center gap-2.5">
            <Snowflake size={22} className="text-[#007AFF]" />
            <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">
              Envanter 360
            </h2>
          </div>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            Fiyat çözümleme, reçete maliyeti, tedarikçi karşılaştırması, raf ömrü, fire ve kör sayım.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1.5 dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl backdrop-blur-md shadow-inner">
          {PANELLER.map((girdi) => (
            <button
              key={girdi.id}
              type="button"
              onClick={() => setPanel(girdi.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
                panel === girdi.id
                  ? 'dark:bg-white/15 bg-white dark:text-white text-[#007AFF] shadow-sm'
                  : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
              }`}
            >
              {girdi.icon}
              <span>{girdi.label}</span>
            </button>
          ))}
        </div>
      </div>

      {panel === 'FIYAT' && <PricingPanel />}
      {panel === 'RECETE' && <RecipePanel />}
      {panel === 'TEDARIKCI' && <SupplierPanel />}
      {panel === 'RAF' && <ShelfLifePanel />}
      {panel === 'FIRE' && <WasteCountPanel />}
    </div>
  );
}