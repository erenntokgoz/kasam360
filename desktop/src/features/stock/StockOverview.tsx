import { useEffect, useMemo, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { StockItemPicker } from './StockItemPicker';
import { StockSupplierPicker } from './StockSupplierPicker';
import { formatNumber } from '../../lib/numberText';


/** Ürün başına eldeki miktar ve maliyet. Hızlı giriş gerçek FIFO partisi açar. */
export function StockOverview() {
  const { products, batches, busy, error, load, quickReceive, pendingQuickReceipt } = useStockStore();
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pendingQuickReceipt) {
      setProductId(pendingQuickReceipt.productId);
      setSupplierId(pendingQuickReceipt.supplierId);
      setQuantity(String(pendingQuickReceipt.quantity).replace('.', ','));
      setUnitCost((pendingQuickReceipt.unitCostCents / 100).toFixed(2).replace('.', ','));
    }
  }, [pendingQuickReceipt]);

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
      if (await quickReceive(productId, amount, parseMoneyToCents(unitCost), supplierId)) {
        setQuantity('');
        setUnitCost('');
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="page-fill flex-1 overflow-y-auto p-4 space-y-4 text-[var(--text-primary)]">
      {error || formError ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error ?? formError}
        </p>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] paper p-4 space-y-3">
        <h2 className="print-title text-sm font-bold">Hızlı stok girişi</h2>
        {pendingQuickReceipt ? <p role="status" className="text-sm">Sipariş oluşturuldu, teslim bekliyor. Aynı kaydın teslimi yeniden denenecek.</p> : null}
        <fieldset disabled={busy || !!pendingQuickReceipt} className="space-y-3">
        <StockSupplierPicker value={supplierId} onChange={setSupplierId} />
        <div className="grid gap-2 sm:grid-cols-4">
          <StockItemPicker products={products} value={productId} onChange={setProductId} label="Giriş ürünü" />
          <NumberInput kind="quantity" aria-label="Giriş miktarı" placeholder="Miktar" className="min-h-12" value={quantity} onValueChange={setQuantity} />
          <NumberInput aria-label="Birim alış fiyatı" placeholder="Birim alış (₺)" className="min-h-12" value={unitCost} onValueChange={setUnitCost} />
        </div>
        </fieldset>
        <Button variant="primary" className="min-h-12" disabled={busy} onClick={() => void receive()}>
          {pendingQuickReceipt ? 'Teslimi Yeniden Dene' : 'Stoğa Ekle'}
        </Button>
      </section>

      <section className="rounded-xl border border-[var(--border)] paper">
        <h2 className="print-title border-b border-[var(--border)] p-4 text-sm font-bold">Eldeki stok</h2>
        {rows.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Ürün yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-bold truncate">{row.name}</span>
              <span className="flex items-center gap-4 tabular-nums">
                <span className={row.quantity > 0 ? '' : 'font-bold text-[var(--accent-red)]'}>
                  {row.quantity > 0 ? `${formatNumber(row.quantity)} ${row.unit}` : 'Stok yok'}
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
