import { useEffect, useState } from 'react';
import { formatMoney } from '../../lib/formatMoney';
import type { ProductDto, RecipeCostDto, RecipeInputDto } from '../../types/menu360';

interface RecipeRow {
  key: string;
  componentProductId: string;
  quantity: string;
  unit: string;
}

interface Props {
  product: ProductDto;
  products: ProductDto[];
  cost: RecipeCostDto | null;
  busy: boolean;
  createRecipe: (input: RecipeInputDto) => Promise<boolean>;
  deactivateRecipe: (productId: string, recipeId: string) => Promise<boolean>;
}

const units = ['adet', 'g', 'kg', 'ml', 'l'];

function positiveNumber(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Miktarlar sıfırdan büyük olmalı.');
  return parsed;
}

export function Menu360RecipeTab({ product, products, cost, busy, createRecipe, deactivateRecipe }: Props) {
  const [name, setName] = useState('');
  const [yieldPercent, setYieldPercent] = useState('100');
  const [outputQuantity, setOutputQuantity] = useState('1');
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    setName(`${product.name} reçetesi`);
    setYieldPercent('100');
    setOutputQuantity('1');
    setRows([]);
    setError(null);
    setConfirmDeactivate(false);
  }, [product.id, product.name]);

  const ingredients = products.filter((candidate) => candidate.id !== product.id);

  const handleCreate = async () => {
    try {
      const output = positiveNumber(outputQuantity);
      const yieldValue = positiveNumber(yieldPercent);
      if (yieldValue > 100 || !name.trim() || rows.length === 0) {
        throw new Error('Ad, malzeme ve %0–100 arası randıman gerekli.');
      }
      const selected = new Set<string>();
      const items = rows.map((row) => {
        if (!row.componentProductId || selected.has(row.componentProductId)) {
          throw new Error('Her malzeme yalnız bir kez seçilmeli.');
        }
        selected.add(row.componentProductId);
        return {
          componentProductId: row.componentProductId,
          quantity: positiveNumber(row.quantity),
          unit: row.unit,
          wastePercent: 0,
          notes: null,
        };
      });
      setError(null);
      await createRecipe({
        productId: product.id,
        name: name.trim(),
        yieldPercent: yieldValue,
        outputQuantity: output,
        outputUnit: 'adet',
        notes: null,
        items,
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (cost) {
    return (
      <div className="space-y-3 text-xs">
        <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <span className="text-[10px] font-bold text-[var(--text-muted)] block">BİRİM MALİYET · FIFO PARTİLERİ</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[var(--text-primary)]">
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
              <span>{item.ingredientName} · {item.quantity} {item.unit}</span>
              <span className="font-mono tabular-nums">
                {item.lineCostCents === null ? 'Bilinmiyor' : formatMoney(item.lineCostCents)}
              </span>
            </div>
          ))}
        </div>
        {confirmDeactivate ? (
          <div className="space-y-2 border border-[var(--accent-red-border)] p-3 rounded">
            <p>Reçete pasife alınacak. Geçmiş kayıtlar korunur.</p>
            <div className="flex gap-2">
              <button type="button" className="tactile-btn min-h-12 px-3 rounded border border-[var(--border)]" onClick={() => setConfirmDeactivate(false)}>Vazgeç</button>
              <button type="button" disabled={busy} className="tactile-btn min-h-12 px-3 rounded bg-[var(--accent-red)] text-white disabled:opacity-50" onClick={() => { void deactivateRecipe(product.id, cost.recipeId).then((ok) => { if (ok) setConfirmDeactivate(false); }); }}>Pasife Al</button>
            </div>
          </div>
        ) : (
          <button type="button" className="tactile-btn min-h-12 px-3 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)]" onClick={() => setConfirmDeactivate(true)}>Reçeteyi Pasife Al</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      <p className="text-[var(--text-secondary)]">Aktif reçete yok. Malzemeleri ekleyerek oluşturun.</p>
      {error && <p role="alert" className="text-[var(--accent-red)]">{error}</p>}
      <label className="block space-y-1"><span>Reçete Adı</span>
        <input className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded px-3 min-h-12" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span>Üretim Miktarı (adet)</span>
          <input inputMode="decimal" className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded px-3 min-h-12" value={outputQuantity} onChange={(event) => setOutputQuantity(event.target.value)} />
        </label>
        <label className="space-y-1"><span>Randıman (%)</span>
          <input inputMode="decimal" className="w-full bg-[var(--bg-subtle)] border border-[var(--border)] rounded px-3 min-h-12" value={yieldPercent} onChange={(event) => setYieldPercent(event.target.value)} />
        </label>
      </div>
      <span className="block font-bold text-[var(--text-secondary)]">Malzemeler</span>
      {rows.map((row) => (
        <div key={row.key} className="p-2 rounded border border-[var(--border)] bg-[var(--bg-subtle)] space-y-2">
          <select aria-label="Malzeme" className="w-full min-h-12 paper border border-[var(--border)] rounded px-2" value={row.componentProductId} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, componentProductId: event.target.value } : item))}>
            <option value="">Malzeme seçin</option>
            {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input aria-label="Malzeme miktarı" inputMode="decimal" placeholder="Miktar" className="min-w-0 flex-1 min-h-12 paper border border-[var(--border)] rounded px-2" value={row.quantity} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: event.target.value } : item))} />
            <select aria-label="Birim" className="w-20 min-h-12 paper border border-[var(--border)] rounded px-1" value={row.unit} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, unit: event.target.value } : item))}>
              {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
            <button type="button" aria-label="Malzemeyi çıkar" className="tactile-btn min-h-12 px-2 rounded border border-[var(--border)]" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>Sil</button>
          </div>
        </div>
      ))}
      <button type="button" disabled={ingredients.length === 0} className="tactile-btn min-h-12 w-full rounded border border-[var(--border)] disabled:opacity-50" onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), componentProductId: '', quantity: '', unit: 'adet' }])}>+ Malzeme Ekle</button>
      <button type="button" disabled={busy || rows.length === 0} className="tactile-btn min-h-12 w-full rounded bg-[var(--brand)] text-white font-bold disabled:opacity-50" onClick={() => void handleCreate()}>Reçeteyi Oluştur</button>
    </div>
  );
}
