import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { formatDay } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { formatNumber } from '../../lib/numberText';
import { EXPIRY_WARNING_DAYS, stockRows, stockTotals } from '../../lib/stockSummary';
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
  const rows = stockRows(products.map((product) => product.id), batches);
  const totals = stockTotals(rows.values());
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
      {products.length > 0 && (
        <dl aria-label="Stok özeti" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ['Kalem', String(products.length)],
            ['Stokta', `${totals.inStock} · tükenen ${totals.outOfStock}`],
            ['Stok Değeri', formatMoney(totals.valueCents)],
            [`Son ${EXPIRY_WARNING_DAYS} Gün SKT`, String(totals.expiring)],
          ] as const).map(([label, value]) => (
            <div key={label} className="paper rounded-xl border border-[var(--border)] px-4 py-3">
              <dt className="text-xs font-semibold text-[var(--text-secondary)]">{label}</dt>
              <dd className="mt-0.5 text-xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {visible.length > 0 && (
        <div className="paper overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th scope="col" className="px-4 py-3 font-medium">Kalem</th>
                <th scope="col" className="px-4 py-3 font-medium">Tür</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Mevcut</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ort. Maliyet</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Stok Değeri</th>
                <th scope="col" className="px-4 py-3 font-medium">En Yakın SKT</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const row = rows.get(product.id);
                const quantity = row?.quantity ?? 0;
                return (
                  <tr key={product.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <td className="p-0 font-semibold">
                      <button type="button" onClick={() => setSelected(product.id)}
                        className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-4 text-left shadow-none focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]">
                        <span className="min-w-0 break-words">{product.name}</span>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" />
                      </button>
                    </td>
                    <td className="px-4 text-[var(--text-secondary)]">{product.isRaw ? 'Hammadde' : 'Satış Ürünü'}</td>
                    <td className={`px-4 text-right tabular-nums ${quantity > 0 ? '' : 'text-[var(--accent-red)]'}`}>
                      {quantity > 0 ? `${formatNumber(quantity)} ${stockUnitLabel(product.stockUnit)}` : 'Stok Yok'}
                    </td>
                    <td className="px-4 text-right tabular-nums">{row?.averageCostCents != null ? formatMoney(row.averageCostCents) : '–'}</td>
                    <td className="px-4 text-right tabular-nums">{quantity > 0 ? formatMoney(row?.valueCents ?? 0) : '–'}</td>
                    <td className="px-4 tabular-nums">{row?.nearestExpiry ? formatDay(row.nearestExpiry) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
