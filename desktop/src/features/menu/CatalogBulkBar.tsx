import React, { useRef, useState } from 'react';
import { useMenuStore } from '../../stores/menuStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

interface CatalogBulkBarProps {
  selected: string[];
  onClear: () => void;
  isSorting: boolean;
  onToggleSort: () => void;
  canEditCatalog: boolean;
}

/** Toplu işlem tek tek ürün komutlarıyla yapılır: her değişiklik ayrı denetim kaydı bırakır. */
export const CatalogBulkBar: React.FC<CatalogBulkBarProps> = ({ selected, onClear, isSorting, onToggleSort, canEditCatalog }) => {
  const { products, toggleProduct86, toggleProductActive, deleteProduct, busy } = useMenuStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const inFlight = useRef(false);
  const [running, setRunning] = useState(false);
  const chosen = products.filter((product) => selected.includes(product.id));

  // Satış durumu yalnız değişmesi gereken üründe çevrilir; iki kez basmak geri almaz.
  const setActive = (id: string, isActive: boolean) =>
    useMenuStore.getState().products.find((product) => product.id === id)?.isActive === isActive
      ? Promise.resolve(true) : toggleProductActive(id);

  const run = async (action: (id: string) => Promise<boolean>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setRunning(true);
    try {
      for (const product of chosen) {
        if (!await action(product.id)) return false;
      }
      onClear();
      return true;
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" aria-pressed={isSorting} variant={isSorting ? 'selected' : 'secondary'} className="min-h-12" onClick={onToggleSort}>
        {isSorting ? 'Sıralamayı Bitir' : 'Sırala'}
      </Button>
      {chosen.length > 0 ? (
        <>
          <span className="text-sm font-bold tabular-nums">{chosen.length} ürün</span>
          <Button variant="secondary" className="min-h-12" disabled={busy || running} onClick={() => void run((id) => toggleProduct86(id, true))}>Tükendi İşaretle</Button>
          <Button variant="secondary" className="min-h-12" disabled={busy || running} onClick={() => void run((id) => toggleProduct86(id, false))}>Tükendi Kaldır</Button>
          <Button variant="secondary" className="min-h-12" disabled={busy || running} onClick={() => void run((id) => setActive(id, false))}>Satıştan Kaldır</Button>
          <Button variant="secondary" className="min-h-12" disabled={busy || running} onClick={() => void run((id) => setActive(id, true))}>Satışa Aç</Button>
          {canEditCatalog ? <Button variant="danger" className="min-h-12" disabled={busy || running} onClick={() => setIsDeleting(true)}>Sil</Button> : null}
          <Button variant="ghost" className="min-h-12" onClick={onClear}>Seçimi Bırak</Button>
        </>
      ) : null}
      {isDeleting ? (
        <ConfirmDialog cardFlow
          title={`${chosen.length} ürün silinsin mi?`}
          message="Silinen ürünler denetim defterine kaydedilir."
          onClose={() => setIsDeleting(false)}
          onConfirm={async () => {
            if (!await run(deleteProduct)) throw new Error(useMenuStore.getState().error ?? 'Seçilen ürünler silinemedi.');
          }}
        />
      ) : null}
    </div>
  );
};
