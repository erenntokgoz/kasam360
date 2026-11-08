import { useEffect, useState } from 'react';
import type { CategoryDto } from '../../types/menu';
import { mapCategory } from '../../lib/menuWire';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { ErrorToast } from '../../ui/ErrorToast';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

interface Props {
  busy: boolean;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}

/** Hammadde satış ürününe çevrilirken menüde duracağı kategori seçilir; yeni kategori menüden açılır. */
export function SaleCategoryPicker({ busy, onPick, onClose }: Props) {
  const [categories, setCategories] = useState<CategoryDto[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      const { actorRole, tenantId } = sessionArgs();
      return invokeIPC<Parameters<typeof mapCategory>[0][]>('get_management_categories', { actorRole, tenantId });
    })
      .then((rows) => { if (active) setCategories(rows.map(mapCategory)); })
      .catch((caught) => { if (active) setError(errorText(caught)); });
    return () => { active = false; };
  }, []);

  return (
    <Modal cardFlow isOpen title="Satış Ürününe Çevir" onClose={() => { if (!busy) onClose(); }} maxWidth="sm">
      <div className="space-y-4">
        <ErrorToast message={error} />
        <label className="block">Menü kategorisi<select className={field} value={categoryId} disabled={busy || !categories}
          onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">{categories ? 'Kategori seçin' : 'Kategoriler yükleniyor'}</option>
          {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button type="button" variant="primary" isLoading={busy} disabled={!categoryId} onClick={() => onPick(categoryId)}>Çevir</Button>
        </div>
      </div>
    </Modal>
  );
}
