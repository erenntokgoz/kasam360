import { useUIStore } from '../../stores/uiStore';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { useEffect, useMemo, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { StockItemPicker } from './StockItemPicker';
import { StockSupplierPicker } from './StockSupplierPicker';
import { formatNumber } from '../../lib/numberText';
import { ReceiptOptions } from './ReceiptOptions';
import { emptyReceiptDraft, toReceiptInput, type ReceiptDraft } from '../../lib/purchaseReceipt';
import { setProductRaw } from '../../lib/stockCreation';


/** Ürün başına eldeki miktar ve maliyet. Hızlı giriş gerçek FIFO partisi açar. */
export function StockOverview() {
  const { products, batches, busy, error, load, quickReceive, pendingQuickReceipt } = useStockStore();
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDraft>(emptyReceiptDraft);
  const [converting, setConverting] = useState<string | null>(null);
  const chosen = products.find((product) => product.id === productId);
  const gramItems = chosen?.stockUnit === 'adet' ? [{ id: chosen.id, name: chosen.name }] : [];

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
            isRaw: product.isRaw,
            quantity: own.reduce((sum, batch) => sum + batch.remainingQuantity, 0),
            grams: own.reduce((sum, batch) => sum + batch.remainingQuantity * (batch.usableGramsPerUnit ?? 0), 0),
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
      const input = toReceiptInput(receipt, gramItems.map((item) => item.id));
      if (await quickReceive(productId, amount, parseMoneyToCents(unitCost), supplierId, input)) {
        useUIStore.getState().showNotice('Stok girişi kaydedildi.');
        setQuantity('');
        setUnitCost('');
        setReceipt(emptyReceiptDraft());
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  // Satış ürününe çevrilen kalem kapalı kalır; fiyatı ve satışa açılması menüden yapılır.
  const convert = async (id: string, isRaw: boolean) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    setConverting(id);
    setFormError(null);
    try {
      const updated = await setProductRaw(product, isRaw);
      useStockStore.setState((state) => ({ products: state.products.map((item) => (item.id === id ? updated : item)) }));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConverting(null);
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
        <ReceiptOptions value={receipt} onChange={setReceipt} gramItems={gramItems} disabled={busy} />
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
              <span className="min-w-0">
                <span className="block font-bold truncate">{row.name}</span>
                <span className="block text-xs text-[var(--text-secondary)]">{row.isRaw ? 'Hammadde' : 'Satış ürünü'}</span>
              </span>
              <span className="flex items-center gap-4 tabular-nums">
                <span className={row.quantity > 0 ? '' : 'font-bold text-[var(--accent-red)]'}>
                  {row.quantity > 0 ? `${formatNumber(row.quantity)} ${stockUnitLabel(row.unit)}` : 'Stok yok'}
                  {row.grams > 0 ? ` · ${formatNumber(Math.round(row.grams))} g` : ''}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">{formatMoney(row.valueCents)}</span>
                <Button variant="secondary" className="min-h-12" disabled={busy || converting !== null} onClick={() => void convert(row.id, !row.isRaw)}>
                  {row.isRaw ? 'Satış Ürününe Çevir' : 'Hammaddeye Çevir'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
