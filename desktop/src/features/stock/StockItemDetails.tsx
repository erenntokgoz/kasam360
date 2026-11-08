import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { formatNumber } from '../../lib/numberText';
import { stockUnitLabel } from '../../lib/stockUnitLabel';
import { deleteStockItem, setProductRaw } from '../../lib/stockCreation';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useStockStore } from '../../stores/stockStore';
import { useUIStore } from '../../stores/uiStore';
import type { ProductDto } from '../../types/menu';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Modal } from '../../ui/Modal';
import { StockItemEditor } from './StockItemEditor';
import { SaleCategoryPicker } from './SaleCategoryPicker';

interface Props {
  product: ProductDto;
  onClose: () => void;
  onEntry: () => void;
}

export function StockItemDetails({ product, onClose, onEntry }: Props) {
  const { batches, suppliers, orders, pendingQuickReceipt } = useStockStore();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [catalogSuppliers, setCatalogSuppliers] = useState<{ supplier_id: string; supplier_name: string }[]>([]);
  const own = batches.filter((batch) => batch.productId === product.id);
  const hasHistory = own.length > 0 || orders.some((order) => order.productIds.includes(product.id));
  const quantity = own.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
  const unit = stockUnitLabel(product.stockUnit);
  const linked = new Map(catalogSuppliers.map((supplier) => [supplier.supplier_id, supplier.supplier_name]));
  for (const supplier of suppliers) {
    if (orders.some((order) => order.status === 'ALINDI' && order.supplierId === supplier.id && order.productIds.includes(product.id))) {
      linked.set(supplier.id, supplier.name);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      const { actorRole, tenantId } = sessionArgs();
      return invokeIPC<{ rows: { supplier_id: string; supplier_name: string }[] }>('compare_supplier_prices_command', {
        actorRole, tenantId, args: { productId: product.id, annualVolume: null },
      });
    }).then((result) => { if (active) setCatalogSuppliers(result.rows); })
      .catch((caught) => { if (active) setSupplierError(errorText(caught)); });
    return () => { active = false; };
  }, [product.id]);

  const convert = async (categoryId?: string) => {
    if (product.isRaw && !categoryId) {
      setPickingCategory(true);
      return;
    }
    setChanging(true);
    setError(null);
    try {
      const updated = await setProductRaw(product, !product.isRaw, categoryId);
      useStockStore.setState((state) => ({ products: state.products.map((item) => item.id === updated.id ? updated : item) }));
      setPickingCategory(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setChanging(false);
    }
  };

  return (
    <>
      <Modal cardFlow isOpen title={product.name} subtitle={product.isRaw ? 'Hammadde' : 'Satış Ürünü'}
        onClose={() => { if (!changing) onClose(); }} maxWidth="lg">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
            <div><dt>Mevcut Miktar</dt><dd className="font-semibold tabular-nums">{formatNumber(quantity)} {unit}</dd></div>
            <div><dt>Stok Birimi</dt><dd className="font-semibold">{unit}</dd></div>
          </dl>
          <section className="space-y-2">
            <h3 className="font-semibold">Tedarikçiler</h3>
            <ErrorToast message={supplierError} />
            {linked.size ? <ul className="flex flex-wrap gap-2">
              {[...linked].map(([id, name]) => <li key={id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">{name}</li>)}
            </ul> : !supplierError && <p className="text-sm text-[var(--text-secondary)]">Bağlı tedarikçi yok.</p>}
          </section>
          {own.length > 0 && <section className="space-y-2">
            <h3 className="font-semibold">Stok Partileri</h3>
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] px-3">
              {own.map((batch) => <li key={batch.id} className="flex flex-wrap justify-between gap-x-3 py-2 text-sm tabular-nums">
                <span>{formatDateTime(batch.receivedAt)}</span>
                <span>{formatNumber(batch.remainingQuantity)} {unit}{batch.usableGramsPerUnit ? ` · ${formatNumber(batch.usableGramsPerUnit)} g/adet` : ''}</span>
                <span>{formatMoney(batch.unitCostCents)} / {unit}</span>
              </li>)}
            </ul>
          </section>}
          <ErrorToast message={error} />
          {hasHistory && <p className="text-sm text-[var(--text-secondary)]">Hareketi veya satın alma kaydı olan kalem silinemez.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={changing || hasHistory || !!pendingQuickReceipt} onClick={() => setDeleting(true)}>Sil</Button>
            <Button variant="ghost" isLoading={changing} onClick={() => void convert()}>
              {product.isRaw ? 'Satış Ürününe Çevir' : 'Hammaddeye Çevir'}
            </Button>
            <Button disabled={changing} onClick={() => setEditing(true)}>Düzenle</Button>
            <Button variant="primary" disabled={changing || (!!pendingQuickReceipt && pendingQuickReceipt.productId !== product.id)} onClick={onEntry}>Stok Girişi</Button>
          </div>
        </div>
      </Modal>
      {pickingCategory && <SaleCategoryPicker busy={changing} onClose={() => setPickingCategory(false)}
        onPick={(categoryId) => void convert(categoryId)} />}
      {editing && <StockItemEditor product={product} initialName={product.name} lockUnit={hasHistory && product.stockUnit !== 'belirsiz'}
        onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {deleting && <ConfirmDialog cardFlow title="Stok Kalemini Sil" message={product.name}
        onClose={() => setDeleting(false)} onConfirm={async () => {
          await deleteStockItem(product.id);
          useStockStore.setState((state) => ({ products: state.products.filter((item) => item.id !== product.id) }));
          useUIStore.getState().showNotice('Stok kalemi silindi.');
          onClose();
        }} />}
    </>
  );
}
