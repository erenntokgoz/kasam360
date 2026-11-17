import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { PAYMENT_LABEL, STATUS_LABEL } from '../../lib/packageModel';
import { customerHistory, removeAddress, saveAddress, saveCustomer } from '../../stores/packageStore';
import type { PackageCustomer, PackageCustomerOrder } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

interface PackageCustomerModalProps {
  /** Boşsa yeni müşteri açılır. */
  customer: PackageCustomer | null;
  onClose: () => void;
  onSaved: () => void;
}

const labelClass = 'block text-xs font-semibold mb-1 text-[var(--text-secondary)]';

/** Müşteri kartı: bilgi, adresler ve geçmiş siparişler. Kayıt hatası pencerede kalır, alanlar silinmez. */
export const PackageCustomerModal: React.FC<PackageCustomerModalProps> = ({ customer, onClose, onSaved }) => {
  const [current, setCurrent] = useState<PackageCustomer | null>(customer);
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [directions, setDirections] = useState('');
  const [history, setHistory] = useState<PackageCustomerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    customerHistory(current.id).then(setHistory).catch((caught) => setError(`Geçmiş okunamadı: ${errorText(caught)}`));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (work: () => Promise<PackageCustomer>) => {
    setIsBusy(true);
    setError(null);
    try {
      const saved = await work();
      setCurrent(saved);
      onSaved();
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={() => { if (!isBusy) onClose(); }} title={current ? current.name : 'Yeni müşteri'} maxWidth="2xl" cardFlow>
      <div className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => { event.preventDefault(); void run(() => saveCustomer({ id: current?.id, phone, name, note })); }}
        >
          <div>
            <label htmlFor="pkg-cus-phone" className={labelClass}>Telefon</label>
            <Input id="pkg-cus-phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div>
            <label htmlFor="pkg-cus-name" className={labelClass}>Ad soyad</label>
            <Input id="pkg-cus-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pkg-cus-note" className={labelClass}>Not</label>
            <Input id="pkg-cus-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" isLoading={isBusy} disabled={!phone.trim() || !name.trim()}>{current ? 'Bilgileri kaydet' : 'Müşteriyi kaydet'}</Button>
          </div>
        </form>

        {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}

        {current ? (
          <>
            <section aria-label="Adresler" className="space-y-2">
              <h3 className="text-sm font-bold">Adresler</h3>
              <ul className="divide-y">
                {current.addresses.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span>{item.label ? <strong>{item.label}: </strong> : null}{item.address}{item.directions ? <span className="block text-[var(--text-secondary)]">Tarif: {item.directions}</span> : null}</span>
                    <button type="button" aria-label="Adresi sil" disabled={isBusy} className="flex size-12 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                      onClick={() => void run(() => removeAddress(item.id))}><Trash2 className="size-4" aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-3">
                <div><label htmlFor="pkg-adr-label" className={labelClass}>Adres adı</label><Input id="pkg-adr-label" value={label} onChange={(event) => setLabel(event.target.value)} /></div>
                <div><label htmlFor="pkg-adr-text" className={labelClass}>Adres</label><Input id="pkg-adr-text" value={address} onChange={(event) => setAddress(event.target.value)} /></div>
                <div><label htmlFor="pkg-adr-dir" className={labelClass}>Tarif</label><Input id="pkg-adr-dir" value={directions} onChange={(event) => setDirections(event.target.value)} /></div>
                <div className="sm:col-span-3">
                  <Button isLoading={isBusy} disabled={!address.trim()} onClick={() => void run(() => saveAddress({ customerId: current.id, label, address, directions })).then((ok) => { if (ok) { setLabel(''); setAddress(''); setDirections(''); } })}>Adres ekle</Button>
                </div>
              </div>
            </section>

            <section aria-label="Geçmiş siparişler" className="space-y-2">
              <h3 className="text-sm font-bold">Geçmiş siparişler</h3>
              {history.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Henüz sipariş yok.</p> : (
                <ul className="divide-y">
                  {history.map((order) => (
                    <li key={order.deliveryId} className="space-y-0.5 py-2 text-sm">
                      <p className="flex flex-wrap justify-between gap-2"><span className="tabular-nums">{formatDateTime(order.createdAt)}</span><strong className="tabular-nums">{formatMoney(order.totalCents)}</strong></p>
                      <p className="text-[var(--text-secondary)]">{order.itemsSummary || '—'} · {PAYMENT_LABEL[order.paymentMethod]} · {STATUS_LABEL[order.status]}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Modal>
  );
};
