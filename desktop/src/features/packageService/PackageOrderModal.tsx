import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { cartSubtotalCents, packageOrderBlocker, PAYMENT_LABEL, toSubmitLines, type PackageCartLine } from '../../lib/packageModel';
import { createPackageOrder, usePackageStore } from '../../stores/packageStore';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import type { PackageCustomer, PackagePayment } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { PackageCustomerPicker } from './PackageCustomerPicker';
import { PackageProductPicker } from './PackageProductPicker';

interface PackageOrderModalProps {
  onClose: () => void;
}

const PAYMENTS: PackagePayment[] = ['CASH', 'CARD', 'ONLINE'];
const labelClass = 'block text-xs font-semibold mb-1 text-[var(--text-secondary)]';

/** Yeni paket siparişi. Kayıt hata verirse girilen müşteri, sepet ve not korunur. */
export const PackageOrderModal: React.FC<PackageOrderModalProps> = ({ onClose }) => {
  const loadCatalog = usePosStore((state) => state.loadCatalog);
  const load = usePackageStore((state) => state.load);
  const [customer, setCustomer] = useState<PackageCustomer | null>(null);
  const [addressId, setAddressId] = useState('');
  const [lines, setLines] = useState<PackageCartLine[]>([]);
  const [fee, setFee] = useState('');
  const [method, setMethod] = useState<PackagePayment>('CASH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadCatalog().catch((caught) => setError(`Menü okunamadı: ${errorText(caught)}`));
  }, [loadCatalog]);

  const feeCents = fee.trim() ? parseCents(fee) : 0;
  const subtotal = cartSubtotalCents(lines);
  const blocker = packageOrderBlocker({ hasCustomer: customer !== null, addressId, lineCount: lines.length, feeValid: feeCents !== null });
  const canSave = blocker === null;

  const save = async () => {
    if (!customer || feeCents === null || blocker) return;
    setIsSaving(true);
    setError(null);
    try {
      await createPackageOrder({
        customerId: customer.id, addressId, items: toSubmitLines(lines), feeCents, paymentMethod: method, note,
      });
      useUIStore.getState().showNotice('Paket siparişi kaydedildi.');
      await load();
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => { if (!isSaving) onClose(); }} title="Yeni paket siparişi" maxWidth="5xl" surface="work">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-label="Müşteri ve adres"><PackageCustomerPicker customer={customer} addressId={addressId} onCustomer={setCustomer} onAddress={setAddressId} /></section>
        <section aria-label="Ürünler"><PackageProductPicker lines={lines} onChange={setLines} /></section>
      </div>

      <div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
        <div>
          <label htmlFor="package-fee" className={labelClass}>Teslimat ücreti</label>
          <NumberInput id="package-fee" kind="money" value={fee} onValueChange={setFee} pinpadTitle="Teslimat ücreti" />
          {feeCents === null ? <p role="alert" className="mt-1 text-xs font-semibold text-[var(--accent-red)]">Geçerli bir tutar yazın.</p> : null}
        </div>
        <div>
          <label htmlFor="package-method" className={labelClass}>Ödeme şekli</label>
          <select id="package-method" className="min-h-12 w-full rounded-full border border-[var(--border)] bg-[var(--glass-tint)] px-4 text-sm"
            value={method} onChange={(event) => setMethod(event.target.value as PackagePayment)}>
            {PAYMENTS.map((value) => <option key={value} value={value}>{PAYMENT_LABEL[value]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="package-note" className={labelClass}>Sipariş notu</label>
          <Input id="package-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </div>
      </div>

      {error ? <InlineAlert className="mt-4" message={error} onDismiss={() => setError(null)} /> : null}
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-surface)] py-3">
        <div>
          <p className="text-lg font-bold tabular-nums">
            Toplam {formatMoney(subtotal + (feeCents ?? 0))}
          </p>
          {blocker ? <p role="status" className="text-xs font-semibold text-[var(--accent-red)]">{blocker}</p> : null}
        </div>
        <Button variant="primary" size="lg" disabled={!canSave} isLoading={isSaving} onClick={() => void save()}>Kaydet ve mutfağa gönder</Button>
      </div>
    </Modal>
  );
};
