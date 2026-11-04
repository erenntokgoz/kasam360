import { useEffect, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { useStockStore } from '../../stores/stockStore';
import { formatDay } from '../../lib/date';
import { StockItemPicker } from './StockItemPicker';
import { StockSupplierPicker } from './StockSupplierPicker';
import { ReceiptOptions } from './ReceiptOptions';
import { emptyReceiptDraft, toReceiptInput, type ReceiptDraft } from '../../lib/purchaseReceipt';
import { batchQuantityText } from '../../lib/stockText';

interface OrderRow {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
}

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';
const button = 'tactile-btn min-h-12 rounded-lg px-4 text-sm font-semibold disabled:opacity-50';

function parseQuantity(value: string): number {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Miktar sıfırdan büyük olmalı.');
  return parsed;
}

export function StockModule() {
  const { products, batches, suppliers, orders, busy, error, load,
    createOrder, receiveOrder } = useStockStore();
  const [supplierId, setSupplierId] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingReceiveId, setPendingReceiveId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDraft>(emptyReceiptDraft);

  useEffect(() => { void load(); }, [load]);

  const handleOrder = async () => {
    try {
      if (!supplierId || !orderNumber.trim() || rows.length === 0) {
        throw new Error('Tedarikçi, sipariş no ve en az bir kalem gerekli.');
      }
      const chosen = new Set<string>();
      const items = rows.map((row) => {
        if (!row.productId || chosen.has(row.productId)) {
          throw new Error('Her ürün siparişte yalnız bir kez bulunmalı.');
        }
        chosen.add(row.productId);
        return { productId: row.productId, quantity: parseQuantity(row.quantity),
          unitCostCents: parseMoneyToCents(row.unitCost) };
      });
      setFormError(null);
      if (await createOrder(supplierId, orderNumber, items)) {
        setOrderNumber('');
        setRows([]);
      }
    } catch (caught: unknown) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const gramItemsOf = (productIds: string[]) =>
    products.filter((product) => productIds.includes(product.id) && product.stockUnit === 'adet')
      .map((product) => ({ id: product.id, name: product.name }));

  const startReceive = (orderId: string) => {
    setReceipt(emptyReceiptDraft());
    setFormError(null);
    setPendingReceiveId(orderId);
  };

  const handleReceive = async (orderId: string, productIds: string[]) => {
    try {
      setFormError(null);
      const input = toReceiptInput(receipt, gramItemsOf(productIds).map((item) => item.id));
      if (await receiveOrder(orderId, input)) setPendingReceiveId(null);
    } catch (caught: unknown) {
      setFormError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="page-fill flex-1 min-h-0 overflow-y-auto bg-[var(--bg-canvas)] p-5 text-[var(--text-primary)]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="print-title text-lg font-bold">Stok ve Satın Alma</h1>
          </div>
          <button type="button" disabled={busy} onClick={() => void load()} className={`${button} border border-[var(--border)] bg-[var(--bg-card)]`}>Yenile</button>
        </div>
        {error && <p role="alert" className="rounded-lg border border-[var(--accent-red-border)] bg-[var(--accent-red-soft)] p-3 text-sm text-[var(--accent-red)]">{error}</p>}
        {formError && <p role="alert" className="rounded-lg border border-[var(--accent-red-border)] bg-[var(--accent-red-soft)] p-3 text-sm text-[var(--accent-red)]">{formError}</p>}

        <div>
          <section className="rounded-xl border border-[var(--border)] paper p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="print-title text-sm font-bold">Satın Alma Siparişi</h2>
              <button type="button" className={`${button} border border-[var(--border)] bg-[var(--bg-card)]`} onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), productId: '', quantity: '', unitCost: '' }])}>Kalem Ekle</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <StockSupplierPicker value={supplierId} onChange={setSupplierId} />
              <label className="block text-xs space-y-1"><span>Sipariş No</span>
                <input className={field} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="Örn: ALIM-001" />
              </label>
            </div>
            {rows.map((row) => (
              <div key={row.key} className="grid items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2 sm:grid-cols-[1fr_80px_110px_48px]">
                <StockItemPicker products={products} value={row.productId} onChange={(productId) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, productId } : item))} label="Alınacak ürün" />
                <NumberInput kind="quantity" aria-label={`Alım miktarı (${products.find((product) => product.id === row.productId)?.stockUnit ?? 'birim'})`} placeholder={products.find((product) => product.id === row.productId)?.stockUnit ?? 'Miktar'} value={row.quantity} onValueChange={(text) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: text } : item))} />
                <NumberInput aria-label="Birim alış fiyatı" placeholder="Birim TL" value={row.unitCost} onValueChange={(text) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, unitCost: text } : item))} />
                <button type="button" aria-label="Kalemi çıkar" className={`${button} border border-[var(--border)] px-2`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>×</button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || rows.length === 0} className={`${button} bg-[var(--brand)] text-white`} onClick={() => void handleOrder()}>Siparişi Oluştur</button>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-[var(--border)] paper overflow-hidden">
          <h2 className="print-title border-b border-[var(--border)] p-4 text-sm font-bold">Satın Alma Siparişleri</h2>
          {orders.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Henüz sipariş yok.</p> : (
            <div className="divide-y divide-[var(--border)]">
              {orders.map((order) => (
                <div key={order.id} className="p-4 text-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><strong>{order.orderNumber}</strong><span className="ml-3 text-xs text-[var(--text-secondary)]">{suppliers.find((supplier) => supplier.id === order.supplierId)?.name ?? 'Tedarikçi'}</span></div>
                    <div className="flex items-center gap-3"><span className="font-mono tabular-nums">{formatMoney(order.totalCents)}</span><span className="text-xs">{order.status === 'ALINDI' ? 'Alındı' : 'Bekliyor'}</span>
                      {order.status === 'TASI' && pendingReceiveId !== order.id ? (
                        <button type="button" disabled={busy} className={`${button} border border-[var(--border)]`} onClick={() => startReceive(order.id)}>Teslim Al</button>
                      ) : null}
                    </div>
                  </div>
                  {order.status === 'TASI' && pendingReceiveId === order.id ? (
                    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                      <ReceiptOptions value={receipt} onChange={setReceipt} gramItems={gramItemsOf(order.productIds)} disabled={busy} />
                      <span className="flex gap-2">
                        <button type="button" className={`${button} border border-[var(--border)]`} onClick={() => setPendingReceiveId(null)}>Vazgeç</button>
                        <button type="button" disabled={busy} className={`${button} bg-[var(--brand)] text-white`} onClick={() => void handleReceive(order.id, order.productIds)}>Teslimi Onayla</button>
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] paper overflow-hidden">
          <h2 className="print-title border-b border-[var(--border)] p-4 text-sm font-bold">Mevcut FIFO Partileri ({batches.length})</h2>
          {batches.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Stok partisi yok.</p> : (
            <div className="divide-y divide-[var(--border)]">
              {batches.map((batch) => (
                <div key={batch.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_110px_130px_140px]">
                  <strong>{batch.productName}</strong>
                  <span className="font-mono tabular-nums">{batchQuantityText(batch)}</span>
                  <span className="font-mono tabular-nums">{formatMoney(batch.unitCostCents)} / {batch.stockUnit}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{formatDay(batch.receivedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
