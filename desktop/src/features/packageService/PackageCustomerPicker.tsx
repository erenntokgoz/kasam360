import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { phoneText } from '../../lib/packageModel';
import { saveAddress, saveCustomer, searchPackageCustomers } from '../../stores/packageStore';
import type { PackageCustomer } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';

interface PackageCustomerPickerProps {
  customer: PackageCustomer | null;
  addressId: string;
  onCustomer: (customer: PackageCustomer | null) => void;
  onAddress: (addressId: string) => void;
}

const labelClass = 'block text-xs font-semibold mb-1 text-[var(--text-secondary)]';

/** Telefonla hızlı arama; kayıt yoksa aynı yerden müşteri ve adres açılır. */
export const PackageCustomerPicker: React.FC<PackageCustomerPickerProps> = ({ customer, addressId, onCustomer, onAddress }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [addressText, setAddressText] = useState('');
  const [directions, setDirections] = useState('');
  const [label, setLabel] = useState('');
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (customer) return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      searchPackageCustomers(query)
        .then((rows) => { if (current) { setResults(rows); setError(null); } })
        .catch((caught) => { if (current) setError(errorText(caught)); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query, customer]);

  const run = async (work: () => Promise<PackageCustomer>, after: (saved: PackageCustomer) => void) => {
    setIsSaving(true);
    setError(null);
    try {
      after(await work());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const addCustomer = () => run(
    () => saveCustomer({ phone: query, name: newName, note: '' }),
    (saved) => { onCustomer(saved); setNewName(''); setIsAddingAddress(saved.addresses.length === 0); },
  );

  const addAddress = () => run(
    () => saveAddress({ customerId: customer?.id ?? '', label, address: addressText, directions }),
    (saved) => {
      onCustomer(saved);
      onAddress(saved.addresses[saved.addresses.length - 1]?.id ?? '');
      setAddressText(''); setDirections(''); setLabel(''); setIsAddingAddress(false);
    },
  );

  const startsLikePhone = /^[\d\s+()-]{5,}$/.test(query.trim());

  if (!customer) {
    return (
      <div className="space-y-3">
        <label htmlFor="package-customer-search" className={labelClass}>Müşteri (telefon ya da ad)</label>
        <Input id="package-customer-search" type="search" inputMode="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
        {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
        <ul className="divide-y">
          {results.map((row) => (
            <li key={row.id}>
              <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 text-left" onClick={() => onCustomer(row)}>
                <span className="font-semibold">{row.name}</span>
                <span className="tabular-nums text-sm text-[var(--text-secondary)]">{phoneText(row.phone)} · {row.orderCount} sipariş</span>
              </button>
            </li>
          ))}
        </ul>
        {startsLikePhone && results.length === 0 ? (
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-sm font-semibold">Bu numara kayıtlı değil. Yeni müşteri açın.</p>
            <label htmlFor="package-new-name" className={labelClass}>Ad soyad</label>
            <Input id="package-new-name" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <Button variant="primary" disabled={!newName.trim()} isLoading={isSaving} onClick={() => void addCustomer()}>Müşteriyi kaydet</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold">{customer.name}</p>
          <p className="tabular-nums text-sm text-[var(--text-secondary)]">{phoneText(customer.phone)}</p>
        </div>
        <Button onClick={() => { onCustomer(null); onAddress(''); setQuery(''); }}>Değiştir</Button>
      </div>
      {customer.note ? <p className="text-sm font-semibold">Not: {customer.note}</p> : null}
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
      <fieldset className="space-y-2">
        <legend className={labelClass}>Teslimat adresi</legend>
        {customer.addresses.map((address) => (
          <label key={address.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
            <input type="radio" name="package-address" className="mt-1 size-5" checked={addressId === address.id} onChange={() => onAddress(address.id)} />
            <span className="text-sm">
              {address.label ? <strong>{address.label}: </strong> : null}{address.address}
              {address.directions ? <span className="block text-[var(--text-secondary)]">Tarif: {address.directions}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      {isAddingAddress || customer.addresses.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <label htmlFor="package-address-label" className={labelClass}>Adres adı (Ev, İş)</label>
          <Input id="package-address-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <label htmlFor="package-address-text" className={labelClass}>Adres</label>
          <Input id="package-address-text" value={addressText} onChange={(event) => setAddressText(event.target.value)} />
          <label htmlFor="package-address-directions" className={labelClass}>Tarif</label>
          <Input id="package-address-directions" value={directions} onChange={(event) => setDirections(event.target.value)} />
          <Button variant="primary" disabled={!addressText.trim()} isLoading={isSaving} onClick={() => void addAddress()}>Adresi kaydet</Button>
        </div>
      ) : <Button onClick={() => setIsAddingAddress(true)}>Yeni adres</Button>}
    </div>
  );
};
