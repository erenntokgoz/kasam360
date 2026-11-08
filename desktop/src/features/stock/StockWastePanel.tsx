import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { formatNumber } from '../../lib/numberText';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';
import { sessionArgs } from '../../stores/cariStore';
import { useStockStore } from '../../stores/stockStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { StockItemPicker } from './StockItemPicker';

interface WasteRow {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  total_cost_cents: number | null;
  notes: string | null;
}

async function listWaste() {
  const { actorRole, tenantId } = sessionArgs();
  return invokeIPC<WasteRow[]>('list_waste_records_command', { actorRole, tenantId, limit: 20 });
}

export function StockWastePanel() {
  const { products, batches, load, error: stockError } = useStockStore();
  const canRecord = useAuthStore((state) => state.user?.role === 'OWNER');
  const [rows, setRows] = useState<WasteRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const available = batches.reduce((sum, batch) => batch.productId === productId ? sum + batch.remainingQuantity : sum, 0);
  const unit = products.find((product) => product.id === productId)?.stockUnit;

  useEffect(() => {
    let active = true;
    void load();
    void listWaste().then((data) => { if (active) setRows(data); })
      .catch((caught) => { if (active) setListError(errorText(caught)); });
    return () => { active = false; };
  }, [load]);

  async function save() {
    if (inFlight.current) return;
    const amount = Number(quantity.trim().replace(',', '.'));
    if (!productId || !Number.isFinite(amount) || amount <= 0 || !notes.trim()) {
      setFormError('Ürün, geçerli miktar ve açıklama gerekli.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      const record = await invokeIPC<WasteRow>('record_waste_command', {
        actorId, actorRole, tenantId,
        args: { productId, reason: 'FIRE_EDILDI', quantity: amount, notes: notes.trim() },
      });
      setRows((current) => [record, ...(current ?? []).filter((row) => row.id !== record.id)].slice(0, 20));
      setOpen(false);
      useUIStore.getState().showNotice('Fire stoğa işlendi.');
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="page-fill flex-1 overflow-y-auto p-4">
      <div className="paper rounded-xl border border-[var(--border)] p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Zayiat ve Fire</h2>
          {canRecord && <Button size="sm" variant="primary" disabled={busy} onClick={() => {
            setProductId(''); setQuantity(''); setNotes(''); setFormError(null); setOpen(true);
          }}>+ Fire Ekle</Button>}
        </header>
        <ErrorToast message={listError} />
        <ErrorToast message={stockError} />
        {!listError && rows === null && <p role="status">Kayıtlar yükleniyor.</p>}
        {rows?.length === 0 && <p>Henüz fire kaydı yok.</p>}
        <ul className="divide-y divide-[var(--border)]">
          {rows?.map((row) => (
            <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <div className="min-w-0 break-words">
                <p className="font-semibold tabular-nums">
                  {row.product_name} · {formatNumber(row.quantity)} {stockUnitLabel(products.find((product) => product.id === row.product_id)?.stockUnit)}
                </p>
                {row.notes && <p className="text-[var(--text-secondary)]">{row.notes}</p>}
              </div>
              <span className="tabular-nums">{row.total_cost_cents === null ? 'Maliyet bilinmiyor' : formatMoney(row.total_cost_cents)}</span>
            </li>
          ))}
        </ul>
      </div>
      <Modal isOpen={open} title="Fire Ekle" onClose={() => { if (!busy) setOpen(false); }} maxWidth="sm">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <StockItemPicker products={products} value={productId} onChange={setProductId} disabled={busy} allowCreate={false} label="Fire ürünü" />
          {productId && <p className="text-sm tabular-nums">Eldeki stok: {formatNumber(available)} {stockUnitLabel(unit)}</p>}
          <label className="block space-y-1"><span>Miktar</span>
            <NumberInput disabled={busy} kind="quantity" value={quantity} onValueChange={setQuantity} />
          </label>
          <label className="block space-y-1"><span>Açıklama</span>
            <textarea required disabled={busy} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)}
              className="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3" />
          </label>
          <ErrorToast message={formError} />
          <div className="flex justify-end gap-2">
            <Button type="button" disabled={busy} onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button type="submit" variant="primary" isLoading={busy}>Stoktan Düş</Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
