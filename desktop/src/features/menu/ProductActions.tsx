import React, { useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useMenuStore } from '../../stores/menuStore';
import type { ProductDto } from '../../types/menu';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { ErrorToast } from '../../ui/ErrorToast';
import { Modal } from '../../ui/Modal';
import { ProductMenuSettings } from './ProductMenuSettings';

export const ProductActions: React.FC<{ product: ProductDto; onClose: () => void }> = ({ product, onClose }) => {
  const canEdit = useAuthStore((state) => state.user?.role === 'OWNER');
  const toggleProductActive = useMenuStore((state) => state.toggleProductActive);
  const deleteProduct = useMenuStore((state) => state.deleteProduct);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const toggleActive = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!await toggleProductActive(product.id)) {
        setError(useMenuStore.getState().error ?? 'Satış durumu değiştirilemedi.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (deleting) return (
    <ConfirmDialog cardFlow title={`${product.name} silinsin mi?`}
      message="Ürün menüden çıkarılır. İşlem denetim kayıtlarında kalır."
      onClose={() => setDeleting(false)} onConfirm={async () => {
        if (!await deleteProduct(product.id)) throw new Error(useMenuStore.getState().error ?? 'Ürün silinemedi.');
        onClose();
      }} />
  );

  if (editing) return (
    <ProductMenuSettings product={product} onBack={() => setEditing(false)} onDelete={() => setDeleting(true)} />
  );

  return (
    <Modal cardFlow isOpen title={product.name} maxWidth="sm" onClose={() => { if (!inFlight.current) onClose(); }}>
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit ? (
          <>
            <Button type="button" variant="danger" disabled={busy} onClick={() => setDeleting(true)}>Sil</Button>
            <Button type="button" disabled={busy} onClick={() => setEditing(true)}>Düzenle</Button>
          </>
        ) : null}
        <Button type="button" variant="primary" isLoading={busy} onClick={() => void toggleActive()}>
          {product.isActive ? 'Satışa Kapat' : 'Satışa Aç'}
        </Button>
      </div>
      <ErrorToast message={error} />
    </Modal>
  );
};
