// Faz 12 · Reçete ve maliyet dökümü paneli.
//
// Kritik kural: maliyeti çözülemeyen bileşen varsa birim maliyet `null` döner ve
// panel "maliyet bilinmiyor" yazar. Kâr marjını `0` kabul edip göstermek,
// patronun yanlış fiyat kararı vermesine yol açar (AGENTS.md §3.4).
//
// Bayrak: `feat_recipe_bom` kapalıyken panel 404 yüzeyi gösterir.

import { useState } from 'react';
import { ChefHat, TriangleAlert } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import {
  ActionButton,
  EmptyState,
  ErrorStrip,
  Field,
  GlassPanel,
  InfoStrip,
  LoadingRows,
  PanelHeader,
} from './inventory360Primitives';
import { money, quantity, type Recipe, type RecipeCost } from './inventory360Types';
import { FeatureOffNotice, NoPermissionNotice, useAsyncCommand, usePanelContext } from './usePanelContext';

export function RecipePanel() {
  const ctx = usePanelContext();
  const [error, setError] = useState<string | null>(null);
  const [seciliUrun, setSeciliUrun] = useState('');
  const [maliyet, setMaliyet] = useState<RecipeCost | null>(null);
  const [hesaplaniyor, setHesaplaniyor] = useState(false);

  const receteler = useAsyncCommand<Recipe[]>(
    'list_inventory_recipes',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '' && ctx.isRecipeBomEnabled,
  );

  if (!ctx.isManager) {
    return (
      <NoPermissionNotice need="Reçete tanımı ve maliyet dökümü işletme sahibinin yetkisindedir." />
    );
  }

  if (!ctx.isRecipeBomEnabled) {
    return (
      <FeatureOffNotice
        featureName="Reçete ve maliyet dökümü"
        hint="Bu işletmede yarı mamul reçete tanımı kapalı. Ürün maliyeti tedarikçi fiyatından ve stok partilerinden hesaplanır."
      />
    );
  }

  async function maliyetCoz() {
    setError(null);
    setHesaplaniyor(true);
    try {
      const sonuc = await invoke<RecipeCost>('get_recipe_cost', {
        tenantId: ctx.tenantId,
        args: { product_id: seciliUrun.trim() },
      });
      setMaliyet(sonuc);
    } catch (hata) {
      setMaliyet(null);
      setError(hata instanceof Error ? hata.message : String(hata));
    } finally {
      setHesaplaniyor(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <ErrorStrip message={error} onDismiss={() => setError(null)} /> : null}
      {receteler.error ? <ErrorStrip message={receteler.error} onDismiss={receteler.reload} /> : null}

      <GlassPanel>
        <PanelHeader
          title="Reçeteler"
          hint="Ürünün hammadde bileşimleri ve randımanı"
          icon={<ChefHat size={18} strokeWidth={1.6} />}
        />
        {receteler.loading ? (
          <LoadingRows />
        ) : !receteler.data || receteler.data.length === 0 ? (
          <EmptyState message="Tanımlı reçete yok. Ürün maliyeti stok partilerinin en güncel birim maliyetinden okunur." />
        ) : (
          <ul className="px-5 pb-5 space-y-2">
            {receteler.data.map((recete) => (
              <li key={recete.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSeciliUrun(recete.product_id);
                    setMaliyet(null);
                  }}
                  className={`w-full text-left flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer ${
                    seciliUrun === recete.product_id
                      ? 'dark:bg-[#007AFF]/15 bg-[#007AFF]/10 border-[#007AFF]/30'
                      : 'dark:bg-white/[0.03] bg-black/[0.02] dark:border-white/5 border-black/[0.05]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium dark:text-white text-zinc-900 truncate">
                      {recete.product_name}
                    </p>
                    <p className="text-[11px] dark:text-zinc-500 text-zinc-500 truncate">
                      {recete.name} · v{recete.version} · randıman %{recete.yield_percent}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono dark:text-zinc-400 text-zinc-500 shrink-0">
                    {quantity(recete.output_quantity, recete.output_unit)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel>
        <PanelHeader
          title="Maliyet dökümü"
          hint="Bileşen maliyetleri çözülür, bilinmeyen ayrıca listelenir"
          icon={<TriangleAlert size={18} strokeWidth={1.6} />}
        />
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <Field
                label="Ürün kimliği"
                value={seciliUrun}
                onChange={setSeciliUrun}
                placeholder="prd_..."
                hint="Yukarıdan bir reçete seçebilir veya ürün kimliğini elle yazabilirsin."
              />
            </div>
            <ActionButton tone="primary" onClick={maliyetCoz} disabled={!seciliUrun.trim() || hesaplaniyor}>
              Çöz
            </ActionButton>
          </div>

          {maliyet && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Birim maliyet" value={money(maliyet.unit_cost_cents)} />
                <Metric label="Toplam malzeme" value={money(maliyet.materials_cost_cents)} />
                <Metric label="Standart üretim" value={money(maliyet.standard_cost_cents)} />
                <Metric
                  label="Çıktı"
                  value={quantity(maliyet.output_quantity, maliyet.output_unit)}
                />
              </div>

              {maliyet.unresolved.length > 0 ? (
                <InfoStrip>
                  {maliyet.unresolved.length} bileşenin maliyeti çözülemedi. Birim maliyet bilinmiyor;
                  kâr marjı hesaplanamaz. Bileşenler: {maliyet.unresolved.join(', ')}
                </InfoStrip>
              ) : null}

              {maliyet.unresolved.length === 0 && maliyet.unit_cost_cents === null ? (
                <InfoStrip>
                  Reçetede bileşen yok ya da çıktı miktarı sıfır; birim maliyet tanımsız. Ürün doğrudan
                  satılan bir ürünse doğrudan alış fiyatı girilmelidir.
                </InfoStrip>
              ) : null}
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3.5 py-3 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]">
      <p className="text-[11px] uppercase tracking-wider dark:text-zinc-500 text-zinc-500">{label}</p>
      <p className="text-sm font-mono dark:text-white text-zinc-900 mt-1">{value}</p>
    </div>
  );
}