import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { emptyReceiptDraft, toReceiptInput } from '../../lib/purchaseReceipt';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { useStockStore } from '../../stores/stockStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { PendingStockReceipts } from './PendingStockReceipts';
import { ReceiptOptions } from './ReceiptOptions';
import { StockItemEditor } from './StockItemEditor';
import { StockItemPicker } from './StockItemPicker';
import { StockSupplierPicker } from './StockSupplierPicker';

export function StockEntryModal({ target, onClose }: { target: string | null; onClose: () => void }) {
  const { products, orders, busy, error, quickReceive, pendingQuickReceipt } = useStockStore();
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [receipt, setReceipt] = useState(emptyReceiptDraft);
  const [showPending, setShowPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (target === null) { setShowPending(false); return; }
    setFormError(null);
    if (pendingQuickReceipt) {
      setProductId(pendingQuickReceipt.productId);
      setSupplierId(pendingQuickReceipt.supplierId);
      setQuantity(String(pendingQuickReceipt.quantity).replace('.', ','));
      const cents = pendingQuickReceipt.unitCostCents;
      setUnitCost(`${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`);
      const saved = pendingQuickReceipt.receipt;
      setReceipt({
        mode: saved.settlement === 'TERM' ? 'TERM' : 'PAID',
        channel: saved.settlement === 'TERM' ? 'CASH' : saved.settlement,
        dueDate: saved.dueDate ?? '',
        documentNo: saved.documentNo ?? '',
        grams: Object.fromEntries(saved.usableGrams.map((item) =>
          [item.productId, String(item.usableGramsPerUnit).replace('.', ',')])),
      });
      return;
    }
    setProductId(target);
    setSupplierId('');
    setQuantity('');
    setUnitCost('');
    setReceipt(emptyReceiptDraft());
  }, [target, pendingQuickReceipt]);

  const chosen = products.find((product) => product.id === productId);
  const unit = stockUnitLabel(chosen?.stockUnit);
  const gramItems = chosen?.stockUnit === 'adet' ? [{ id: chosen.id, name: chosen.name }] : [];

  const receive = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setFormError(null);
    try {
      const amount = Number(quantity.trim().replace(',', '.'));
      if (!chosen || !supplierId || !Number.isFinite(amount) || amount <= 0 || !unitCost.trim()) {
        throw new Error('Tedarikçi, ürün, miktar ve birim fiyat gerekli.');
      }
      const input = toReceiptInput(receipt, gramItems.map((item) => item.id));
      if (await quickReceive(chosen.id, amount, parseMoneyToCents(unitCost), supplierId, input)) {
        useUIStore.getState().showNotice('Stok girişi kaydedildi.');
        onClose();
      }
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      submitting.current = false;
    }
  };

  const pendingOrders = orders.filter((order) => order.status === 'TASI' && order.id !== pendingQuickReceipt?.orderId);
  const blocked = busy || !!pendingQuickReceipt;
  return (
    <Modal cardFlow isOpen={target !== null} title={showPending ? "Bekleyen Teslimler" : "Stok Girişi"} maxWidth="lg"
      onClose={() => { if (!submitting.current && !busy) onClose(); }}
      headerActions={!showPending && !blocked && !target ? <Button type="button" onClick={() => setCreating(true)}>+ Yeni Kalem</Button> : undefined}>
      {showPending ? <PendingStockReceipts orders={pendingOrders} onBack={() => setShowPending(false)} /> : <div className="space-y-4">
        {!pendingQuickReceipt && pendingOrders.length > 0 && !target &&
          <Button type="button" disabled={busy} onClick={() => setShowPending(true)}>Bekleyen Teslimler ({pendingOrders.length})</Button>}
        {pendingQuickReceipt && <p role="status" className="text-sm">Sipariş oluşturuldu. Aynı kaydın teslimini yeniden deneyin.</p>}
        <ReceiptOptions value={receipt} onChange={setReceipt} gramItems={[]} disabled={busy} />
        <p className="text-xs text-[var(--text-secondary)]">
            Peşin stok alımı kâr gideri değildir; maliyeti satışta FIFO ile “Satılan Malın Maliyeti”ne geçer. Nakit seçildiğinde ödeme kasadan çıkar ve mevcut kasa bakiyesi eksiye düşebilir. Havale/kart ödemesi tedarikçi cari hareketinde görünür.
        </p>
        <fieldset disabled={blocked} className="space-y-3">
          <StockSupplierPicker value={supplierId} onChange={setSupplierId} />
          {target || pendingQuickReceipt
            ? <p className="text-sm font-semibold">{chosen?.name} · {unit}</p>
            : <StockItemPicker products={products} value={productId} onChange={setProductId} label="Giriş ürünü" allowCreate={false} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Miktar{chosen ? ` (${unit})` : ''}</span>
              <NumberInput kind="quantity" disabled={!chosen} value={quantity} onValueChange={setQuantity} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Birim Alış Fiyatı (₺)</span>
              <NumberInput disabled={!chosen} value={unitCost} onValueChange={setUnitCost} />
            </label>
          </div>
        </fieldset>
        {gramItems.length > 0 && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">1 Adetten Çıkan Kullanılabilir Gram (isteğe bağlı)</span>
            <NumberInput kind="quantity" disabled={busy} value={receipt.grams[productId] ?? ''}
              onValueChange={(value) => setReceipt({ ...receipt, grams: { ...receipt.grams, [productId]: value } })} />
          </label>
        )}
        <ErrorToast message={formError ?? error} />
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" isLoading={busy} onClick={() => void receive()}>
            {pendingQuickReceipt ? 'Teslimi Yeniden Dene' : 'Stoğa Ekle'}
          </Button>
        </div>
      </div>}
      {creating && <StockItemEditor onClose={() => setCreating(false)} onSaved={(product) => {
        setProductId(product.id);
        setCreating(false);
      }} />}
    </Modal>
  );
}
