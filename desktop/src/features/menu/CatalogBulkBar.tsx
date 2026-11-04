import React, { useState } from 'react';
import { useMenuStore } from '../../stores/menuStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

interface CatalogBulkBarProps {
  selected: string[];
  onClear: () => void;
  isSorting: boolean;
  onToggleSort: () => void;
}

/** Toplu işlem tek tek ürün komutlarıyla yapılır: her değişiklik ayrı denetim kaydı bırakır. */
export const CatalogBulkBar: React.FC<CatalogBulkBarProps> = ({ selected, onClear, isSorting, onToggleSort }) => {
  const { products, toggleProduct86, toggleProductActive, deleteProduct, busy } = useMenuStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const chosen = products.filter((product) => selected.includes(product.id));

  const run = async (action: (id: string) => Promise<unknown>) => {
    for (const product of chosen) await action(product.id);
    onClear();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={isSorting ? 'selected' : 'secondary'} className="min-h-12" onClick={onToggleSort}>
        {isSorting ? 'Sıralamayı Bitir' : 'Sırala'}
      </Button>
      {chosen.length > 0 ? (
        <>
          <span className="text-sm font-bold tabular-nums">{chosen.length} ürün</span>
          <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => void run((id) => toggleProduct86(id, true))}>Tükendi</Button>
          <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => void run((id) => toggleProduct86(id, false))}>Satışa Aç</Button>
          <Button
            variant="secondary"
            className="min-h-12"
            disabled={busy}
            onClick={() => void run(async (id) => {
              if (products.find((product) => product.id === id)?.isActive) await toggleProductActive(id);
            })}
          >
            Pasife Al
          </Button>
          <Button variant="danger" className="min-h-12" disabled={busy} onClick={() => setIsDeleting(true)}>Sil</Button>
          <Button variant="ghost" className="min-h-12" onClick={onClear}>Seçimi Bırak</Button>
        </>
      ) : null}
      {isDeleting ? (
        <ConfirmDialog
          title={`${chosen.length} ürün silinsin mi?`}
          message="Silinen ürünler denetim defterine kaydedilir."
          onClose={() => setIsDeleting(false)}
          onConfirm={() => run(deleteProduct)}
        />
      ) : null}
    </div>
  );
};
