import { ErrorToast } from '../../ui/ErrorToast';
import { capitalizeRecordName } from '../../lib/recordName';
import { useState } from 'react';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { foldText } from '../../lib/searchText';
import { useAuthStore } from '../../stores/authStore';

/** Tedarikçi açılırken satın alma satırları ve üst form olduğu gibi korunur. */
export function StockSupplierPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { suppliers, createSupplier, busy, error } = useStockStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const canCreate = useAuthStore((state) => state.user?.role === 'OWNER');
  const existing = name.trim() ? suppliers.filter((supplier) => foldText(supplier.name).includes(foldText(name))) : [];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 flex-1 min-w-48 text-xs font-semibold text-[var(--text-secondary)]">Tedarikçi
        <select aria-label="Tedarikçi" className="w-full min-h-12 border border-[var(--border)] bg-[var(--bg-subtle)] rounded px-3 text-sm font-normal text-[var(--text-primary)]" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Tedarikçi seçin</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </label>
      {canCreate ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setName(''); setOpen(true); }}>Yeni Tedarikçi</Button> : null}
      <Modal cardFlow isOpen={open} title="Yeni tedarikçi" onClose={() => { if (!busy) setOpen(false); }} maxWidth="sm">
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void createSupplier(name, (supplier) => { onChange(supplier.id); setOpen(false); });
        }}>
          <label className="block">Firma veya kişi adı<Input required maxLength={120} value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))} onChange={(event) => setName(event.target.value)} /></label>
          {existing.length ? <div className="space-y-2"><p className="text-sm">Benzer kayıtlar var. Mevcut tedarikçiyi seçebilir veya ayrı kayıt oluşturabilirsiniz.</p>
            {existing.map((supplier) => <Button key={supplier.id} type="button" variant="secondary" disabled={busy} onClick={() => { onChange(supplier.id); setOpen(false); }}>{supplier.name} — Seç</Button>)}
          </div> : null}
          <ErrorToast message={error} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button type="submit" variant="primary" isLoading={busy} disabled={!name.trim()}>Oluştur ve Seç</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
