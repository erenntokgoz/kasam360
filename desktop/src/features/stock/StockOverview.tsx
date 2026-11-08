import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { formatNumber } from '../../lib/numberText';
import { matchesProduct } from '../../lib/searchText';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { StockEntryModal } from './StockEntryModal';
import { StockItemDetails } from './StockItemDetails';
import { StockItemEditor } from './StockItemEditor';

interface Props {
  target: string | null;
  onEntry: (id: string) => void;
  onCloseEntry: () => void;
}

export function StockOverview({ target, onEntry, onCloseEntry }: Props) {
  const { products, batches, busy, error, load, pendingQuickReceipt } = useStockStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { void load(); }, [load]);

  const selectedProduct = products.find((product) => product.id === selected);
  const quantities = new Map<string, number>();
  for (const batch of batches) {
    quantities.set(batch.productId, (quantities.get(batch.productId) ?? 0) + batch.remainingQuantity);
  }
  const visible = products
    .filter((product) => matchesProduct(query, product.name, product.barcode, product.sku))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const showProduct = selectedProduct && target === null;

  return (
    <section className="page-fill flex-1 overflow-y-auto p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Mevcut Stoklar</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <Search aria-hidden="true" className="size-4" />
            <Input type="search" aria-label="Stok kalemi ara"
              value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Button disabled={busy} onClick={() => setCreating(true)}>+ Yeni Kalem</Button>
        </div>
      </header>
      <ErrorToast message={target === null ? error : null} />
      {pendingQuickReceipt && target === null && (
        <Button onClick={() => onEntry(pendingQuickReceipt.productId)}>Bekleyen Teslimi Aç</Button>
      )}
      {visible.length === 0 && <p role="status">{busy ? 'Stoklar yükleniyor.' : query.trim() ? 'Eşleşen stok kalemi yok.' : 'Henüz stok kalemi yok.'}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
        {visible.map((product) => {
          const quantity = quantities.get(product.id) ?? 0;
          return (
            <li key={product.id}>
              <button type="button" onClick={() => setSelected(product.id)}
                className="paper min-h-24 w-full rounded-xl border border-[var(--border)] p-4 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
                <span className="flex items-center justify-between gap-2 font-semibold">
                  <span className="min-w-0 break-words">{product.name}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
                </span>
                <span className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm">
                  <span className="text-[var(--text-secondary)]">{product.isRaw ? 'Hammadde' : 'Satış Ürünü'}</span>
                  <span className="tabular-nums">{quantity > 0 ? `${formatNumber(quantity)} ${stockUnitLabel(product.stockUnit)}` : 'Stok Yok'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {showProduct && <StockItemDetails product={selectedProduct}
        onClose={() => setSelected(null)} onEntry={() => onEntry(selectedProduct.id)} />}
      {creating && <StockItemEditor onClose={() => setCreating(false)} onSaved={(product) => {
        setCreating(false);
        setQuery('');
        setSelected(product.id);
      }} />}
      <StockEntryModal target={target} onClose={onCloseEntry} />
    </section>
  );
}
