import { ErrorToast } from '../../ui/ErrorToast';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { capitalizeRecordName } from '../../lib/recordName';
import { useEffect, useRef, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { formatMoney } from '../../lib/formatMoney';
import type { ProductDto, RecipeCostDto, RecipeInputDto } from '../../types/menu';
import { StockItemPicker } from '../stock/StockItemPicker';
import { useStockStore } from '../../stores/stockStore';
import { formatNumber } from '../../lib/numberText';

interface RecipeRow {
  key: string;
  componentProductId: string;
  quantity: string;
  unit: string;
  wastePercent?: number;
  notes?: string | null;
}

interface StoredRecipe {
  id: string;
  name: string;
  yield_percent: number;
  output_quantity: number;
  output_unit: string;
  notes: string | null;
  items: Array<{ component_product_id: string; quantity: number; unit: string; waste_percent: number; notes: string | null }>;
}

interface Props {
  product: ProductDto;
  products: ProductDto[];
  cost: RecipeCostDto | null;
  busy: boolean;
  createRecipe: (input: RecipeInputDto, replaceRecipeId?: string) => Promise<boolean>;
  deactivateRecipe: (productId: string, recipeId: string) => Promise<boolean>;
}

const units = ['adet', 'g', 'kg', 'ml', 'l'];

// Satışta stok birimine çevrilemeyen birim kayıtta reddedilir; seçenek baştan uyumlularla sınırlanır.
// Adetle tutulan kalem gram isteyebilir: partinin adet başına kullanılabilir gramı çevirir.
function compatibleUnits(stockUnit: string | undefined, current: string): string[] {
  const allowed = stockUnit === 'g' || stockUnit === 'kg' ? ['g', 'kg']
    : stockUnit === 'ml' || stockUnit === 'l' ? ['ml', 'l']
      : stockUnit === 'adet' ? ['adet', 'g', 'kg'] : units;
  return allowed.includes(current) ? allowed : [...allowed, current];
}

function positiveNumber(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Miktarlar sıfırdan büyük olmalı.');
  return parsed;
}

export function MenuRecipeTab({ product, products, cost, busy, createRecipe, deactivateRecipe }: Props) {
  const outputUnit = product.stockUnit && units.includes(product.stockUnit) ? product.stockUnit : 'adet';
  const stockProducts = useStockStore((state) => state.products);
  const [name, setName] = useState('');
  const [yieldPercent, setYieldPercent] = useState('100');
  const [outputQuantity, setOutputQuantity] = useState('1');
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoredRecipe | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const editRequest = useRef(0);
  const owner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    editRequest.current += 1;
    setLoadingEdit(false);
    setName(`${product.name} reçetesi`);
    setYieldPercent('100');
    setOutputQuantity('1');
    setRows([]);
    setError(null);
    setConfirmDeactivate(false);
    setEditing(null);
  }, [product.id, product.name]);

  // Ana ürün deposunu yenilemek üstteki kaydedilmemiş ürün formunu sıfırlardı.
  // Malzeme stok kalemidir; menü ürünü yalnız eski reçetede zaten kullanılıyorsa listede kalır.
  const used = new Set(rows.map((row) => row.componentProductId));
  const ingredients = [...new Map([...products, ...stockProducts].map((item) => [item.id, item])).values()]
    .filter((candidate) => candidate.id !== product.id && (candidate.isRaw || used.has(candidate.id)));
  const recipeOutputUnit = editing && units.includes(editing.output_unit) ? editing.output_unit : outputUnit;

  const beginEdit = async () => {
    if (!cost || loadingEdit) return;
    setError(null);
    setLoadingEdit(true);
    const request = ++editRequest.current;
    try {
      const { actorRole, tenantId } = sessionArgs();
      const activeModules = useAuthStore.getState().user?.activeModules ?? [];
      const recipes = await invokeIPC<StoredRecipe[]>('list_inventory_recipes', { actorRole, tenantId, activeModules });
      if (request !== editRequest.current) return;
      const recipe = recipes.find((item) => item.id === cost.recipeId);
      if (!recipe) throw new Error('Reçete değişti. Ürünü yeniden açın.');
      setName(recipe.name);
      setOutputQuantity(String(recipe.output_quantity));
      setYieldPercent(String(recipe.yield_percent));
      setRows(recipe.items.map((item) => ({
        key: crypto.randomUUID(), componentProductId: item.component_product_id, quantity: String(item.quantity),
        unit: item.unit, wastePercent: item.waste_percent, notes: item.notes,
      })));
      setEditing(recipe);
    } catch (caught) {
      if (request === editRequest.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (request === editRequest.current) setLoadingEdit(false);
    }
  };

  const handleCreate = async () => {
    try {
      const output = positiveNumber(outputQuantity);
      const yieldValue = positiveNumber(yieldPercent);
      if (yieldValue > 100 || !name.trim() || rows.length === 0) {
        throw new Error('Ad, malzeme ve %0–100 arası randıman gerekli.');
      }
      const selected = new Set<string>();
      const items = rows.map((row, index) => {
        if (!row.componentProductId) throw new Error(`${index + 1}. satırda malzeme seçin.`);
        if (selected.has(row.componentProductId)) {
          throw new Error('Her malzeme yalnız bir kez seçilmeli.');
        }
        selected.add(row.componentProductId);
        return {
          componentProductId: row.componentProductId,
          quantity: positiveNumber(row.quantity),
          unit: row.unit,
          wastePercent: row.wastePercent ?? 0,
          notes: row.notes ?? null,
        };
      });
      setError(null);
      const saved = await createRecipe({
        productId: product.id,
        name: name.trim(),
        yieldPercent: yieldValue,
        outputQuantity: output,
        outputUnit: recipeOutputUnit,
        notes: editing?.notes ?? null,
        items,
      }, editing?.id);
      if (saved) setEditing(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (cost && !editing) {
    return (
      <div className="space-y-3 text-xs">
        <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-muted)] block">BİRİM MALİYET · FIFO PARTİLERİ</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
            {cost.totalCostCents === null ? 'Bilinmiyor' : formatMoney(cost.totalCostCents)}
          </span>
        </div>
        {cost.unresolvedCount > 0 && (
          <p className="text-[var(--accent-amber)]">
            {cost.unresolvedCount} malzemenin parti maliyeti çözülemedi; toplam maliyet bilinmiyor.
          </p>
        )}
        <div className="space-y-1">
          <span className="text-[var(--text-secondary)] font-bold">Malzemeler ({cost.items.length})</span>
          {cost.items.map((item) => (
            <div key={item.ingredientId} className="p-2 rounded bg-[var(--bg-subtle)] border border-[var(--border)] flex justify-between gap-2">
              <span>{item.ingredientName} · {formatNumber(item.quantity)} {stockUnitLabel(item.unit)}</span>
              <span className="font-mono tabular-nums">
                {item.lineCostCents === null ? 'Bilinmiyor' : formatMoney(item.lineCostCents)}
              </span>
            </div>
          ))}
        </div>
        {error ? <ErrorToast message={error} /> : null}
        {owner && <button type="button" disabled={busy || loadingEdit} className="tactile-btn min-h-12 px-3 rounded border border-[var(--border)]" onClick={() => void beginEdit()}>Reçeteyi Düzenle</button>}
        {owner && (confirmDeactivate ? (
          <div className="space-y-2 border border-[var(--accent-red-border)] p-3 rounded">
            <p>Reçete pasife alınacak. Geçmiş kayıtlar korunur.</p>
            <div className="flex gap-2">
              <button type="button" className="tactile-btn min-h-12 px-3 rounded border border-[var(--border)]" onClick={() => setConfirmDeactivate(false)}>Vazgeç</button>
              <button type="button" disabled={busy} className="tactile-btn min-h-12 px-3 rounded bg-[var(--accent-red)] text-white disabled:opacity-50" onClick={() => { void deactivateRecipe(product.id, cost.recipeId).then((ok) => { if (ok) setConfirmDeactivate(false); }); }}>Pasife Al</button>
            </div>
          </div>
        ) : (
          <button type="button" className="tactile-btn min-h-12 px-3 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)]" onClick={() => setConfirmDeactivate(true)}>Reçeteyi Pasife Al</button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      <p className="text-[var(--text-secondary)]">{editing ? 'Reçeteyi Düzenle' : 'Reçete yok.'}</p>
      {error && <ErrorToast message={error} />}
      <label className="block space-y-1"><span>Reçete Adı</span>
        <input className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded px-3 min-h-12" value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))} onChange={(event) => setName(event.target.value)} />
      </label>
      <details className="space-y-2">
        <summary className="cursor-pointer">Üretim Ayarları</summary>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span>Üretim Miktarı ({stockUnitLabel(recipeOutputUnit)})</span>
          <NumberInput kind="quantity" className="w-full" value={outputQuantity} onValueChange={setOutputQuantity} />
        </label>
        <label className="space-y-1"><span>Randıman (%)</span>
          <NumberInput kind="quantity" className="w-full" value={yieldPercent} onValueChange={setYieldPercent} />
        </label>
      </div>
      </details>
      <span className="block font-bold text-[var(--text-secondary)]">Malzemeler</span>
      {rows.map((row) => {
        const ingredient = ingredients.find((item) => item.id === row.componentProductId);
        return <div key={row.key} className="p-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] space-y-2">
          <StockItemPicker products={ingredients.filter((candidate) => !rows.some((other) =>
            other.key !== row.key && other.componentProductId === candidate.id
          ))} value={row.componentProductId} label="Malzeme" onChange={(componentProductId) => {
            const selected = useStockStore.getState().products.find((item) => item.id === componentProductId)
              ?? ingredients.find((item) => item.id === componentProductId);
            setError(null);
            setRows((current) => current.map((item) => item.key === row.key ? { ...item, componentProductId, unit: selected?.stockUnit ?? 'adet' } : item));
          }} />
          <div className="flex gap-2">
            <NumberInput kind="quantity" aria-label="Malzeme miktarı" className="min-w-0 flex-1" value={row.quantity} onValueChange={(text) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: text } : item))} />
            <select aria-label="Birim" className="w-28 min-h-12 paper border border-[var(--border)] rounded px-1" value={row.unit} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, unit: event.target.value } : item))}>
              {compatibleUnits(ingredient?.stockUnit, row.unit).map((unit) => <option key={unit} value={unit}>{stockUnitLabel(unit)}</option>)}
            </select>
            <button type="button" aria-label="Malzemeyi çıkar" className="tactile-btn min-h-12 px-2 rounded border border-[var(--border)]" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>Sil</button>
          </div>
          {ingredient?.stockUnit === 'adet' && (row.unit === 'g' || row.unit === 'kg') && (
            <p className="text-[var(--text-secondary)]">Mal kabulünde adet başına kullanılabilir gramı girin.</p>
          )}
        </div>;
      })}
      <button type="button" className="tactile-btn min-h-12 px-3 rounded border border-[var(--border)]" onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), componentProductId: '', quantity: '', unit: 'adet' }])}>+ Malzeme Ekle</button>
      <button type="button" disabled={busy || rows.length === 0} className="tactile-btn min-h-12 px-4 rounded bg-[var(--brand)] text-white font-bold disabled:opacity-50" onClick={() => void handleCreate()}>{editing ? 'Reçeteyi Kaydet' : 'Reçeteyi Oluştur'}</button>
      {editing && <button type="button" disabled={busy} className="tactile-btn min-h-12 px-3" onClick={() => { setError(null); setEditing(null); }}>Vazgeç</button>}
    </div>
  );
}
