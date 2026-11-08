import { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { emptyReceiptDraft, toReceiptInput } from '../../lib/purchaseReceipt';
import { useStockStore } from '../../stores/stockStore';
import { useUIStore } from '../../stores/uiStore';
import type { StockPurchaseOrder } from '../../types/stock';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { ReceiptOptions } from './ReceiptOptions';

export function PendingStockReceipts({ orders, onBack }: { orders: StockPurchaseOrder[]; onBack: () => void }) {
  const { suppliers, products, busy, error, receiveOrder } = useStockStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyReceiptDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const selected = orders.find((order) => order.id === selectedId);
  const supplierName = (order: StockPurchaseOrder) => suppliers.find((supplier) => supplier.id === order.supplierId)?.name ?? 'Tedarikçi';
  const grams = selected ? products
    .filter((product) => selected.productIds.includes(product.id) && product.stockUnit === 'adet')
    .map(({ id, name }) => ({ id, name })) : [];

  async function receive() {
    if (!selected || busy) return;
    setFormError(null);
    try {
      const input = toReceiptInput(draft, grams.map((item) => item.id));
      if (await receiveOrder(selected.id, input)) {
        setSelectedId(null);
        useUIStore.getState().showNotice('Mal kabulü kaydedildi.');
      }
    } catch (caught) {
      setFormError(errorText(caught));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorToast message={formError ?? error} />
      <Button type="button" disabled={busy} onClick={() => {
        setFormError(null);
        if (selected) setSelectedId(null);
        else onBack();
      }}>{selected ? 'Bekleyen Teslimler' : 'Stok Girişine Dön'}</Button>
      {selected ? (
        <>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <h3 className="font-semibold">{supplierName(selected)}</h3>
            <p className="text-sm tabular-nums">{selected.orderNumber} · {formatMoney(selected.totalCents)}</p>
          </div>
          <ReceiptOptions value={draft} onChange={setDraft} gramItems={grams} disabled={busy} />
          <Button type="button" variant="primary" isLoading={busy} onClick={() => void receive()}>Teslimi Onayla</Button>
        </>
      ) : (
        <ul className="space-y-2">
          {orders.length === 0 && <li>Bekleyen teslim yok.</li>}
          {orders.map((order) => (
            <li key={order.id}>
              <Button type="button" disabled={busy} className="w-full !justify-between" onClick={() => {
                setDraft(emptyReceiptDraft());
                setSelectedId(order.id);
              }}>
                <span className="text-left">{supplierName(order)} · {order.orderNumber}</span>
                <span className="tabular-nums">{formatMoney(order.totalCents)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
