import { ErrorToast } from '../../ui/ErrorToast';
import { useRef, useState } from 'react';
import type { ProductDto } from '../../types/menu';
import { createStockItem, updateStockItem } from '../../lib/stockCreation';
import { capitalizeRecordName } from '../../lib/recordName';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { errorText } from '../../lib/cariInput';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

interface Props {
  product?: ProductDto;
  initialName?: string;
  lockUnit?: boolean;
  onSaved: (product: ProductDto) => void;
  onClose: () => void;
}

/** Stok kalemi menü kategorisi taşımaz: kategori seçtirmek hammaddeyi menüye karıştırırdı. */
export function StockItemEditor({ product, initialName = '', lockUnit = false, onSaved, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState(product?.stockUnit ?? 'adet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitting = useRef(false);
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const fields = { name: capitalizeRecordName(name), stockUnit: unit };
      const saved = product ? await updateStockItem(product, fields) : await createStockItem(fields);
      useStockStore.setState((state) => ({ products: [...state.products.filter((item) => item.id !== saved.id), saved] }));
      onSaved(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal cardFlow isOpen title={product ? "Stok Kalemini Düzenle" : "Yeni Stok Kalemi"} onClose={() => { if (!submitting.current) onClose(); }} maxWidth="sm">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void save(); }}>
        <ErrorToast message={error} />
        <label className="block">Ad<Input required maxLength={120} value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block">Stok birimi<select className={field} value={unit} disabled={busy || lockUnit} onChange={(event) => setUnit(event.target.value)}>
          {['adet', 'g', 'kg', 'ml', 'l', ...(unit === 'belirsiz' ? ['belirsiz'] : [])].map((item) => <option key={item} value={item}>{stockUnitLabel(item)}</option>)}
        </select></label>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" isLoading={busy} disabled={unit === 'belirsiz' || !name.trim()}>{product ? 'Kaydet' : 'Kalemi Oluştur'}</Button>
        </div>
      </form>
    </Modal>
  );
}
