import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

const select = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';

/** Ürün başına eldeki miktar ve maliyet. Hızlı giriş gerçek FIFO partisi açar. */
export function StockOverview() {
  const { products, batches, busy, error, load, quickReceive } = useStockStore();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      products
        .map((product) => {
          const own = batches.filter((batch) => batch.productId === product.id);
          return {
            id: product.id,
            name: product.name,
            unit: product.stockUnit,
            quantity: own.reduce((sum, batch) => sum + batch.remainingQuantity, 0),
            valueCents: own.reduce((sum, batch) => sum + Math.round(batch.remainingQuantity * batch.unitCostCents), 0),
          };
        })
        .sort((a, b) => a.quantity - b.quantity),
    [products, batches],
  );

  const receive = async () => {
    setFormError(null);
    const amount = Number(quantity.trim().replace(',', '.'));
    try {
      if (!productId || !Number.isFinite(amount) || amount <= 0) throw new Error('Ürün ve miktar girin.');
      if (await quickReceive(productId, amount, parseMoneyToCents(unitCost))) {
        setQuantity('');
        setUnitCost('');
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5 text-[var(--text-primary)]">
      {error || formError ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error ?? formError}
        </p>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] paper p-4 space-y-3">
        <h2 className="print-title text-xl">Hızlı stok girişi</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Giriş ürünü" className={select} value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Ürün seçin</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <Input aria-label="Giriş miktarı" inputMode="decimal" placeholder="Miktar" className="min-h-12" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <Input aria-label="Birim alış fiyatı" inputMode="decimal" placeholder="Birim alış (₺)" className="min-h-12" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
          <Button variant="primary" className="min-h-12" disabled={busy} onClick={() => void receive()}>
            Stoğa Ekle
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] paper">
        <h2 className="border-b border-[var(--border)] p-4 print-title text-xl">Eldeki stok</h2>
        {rows.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Henüz ürün yok. Ürünü Menü sekmesinden ekleyin.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-bold truncate">{row.name}</span>
              <span className="flex items-center gap-4 tabular-nums">
                <span className={row.quantity > 0 ? '' : 'font-bold text-[var(--accent-red)]'}>
                  {row.quantity > 0 ? `${row.quantity} ${row.unit}` : 'Stok yok'}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">{formatMoney(row.valueCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
