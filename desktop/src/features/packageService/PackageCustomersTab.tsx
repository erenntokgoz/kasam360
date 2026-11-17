import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { phoneText } from '../../lib/packageModel';
import { searchPackageCustomers } from '../../stores/packageStore';
import type { PackageCustomer } from '../../types/packageService';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { PackageCustomerModal } from './PackageCustomerModal';

/** Müşteri rehberi: telefon ya da adla arama, satır müşteri kartını açar. */
export const PackageCustomersTab: React.FC = () => {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PackageCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PackageCustomer | 'NEW' | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      searchPackageCustomers(query)
        .then((next) => { if (current) { setRows(next); setError(null); } })
        .catch((caught) => { if (current) setError(errorText(caught)); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query, reload]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="bar-search">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input type="search" aria-label="Müşteri ara" placeholder="Telefon ya da ad" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <Button variant="primary" onClick={() => setOpen('NEW')}><Plus className="size-4" aria-hidden="true" />Yeni müşteri</Button>
      </div>
      {error ? <InlineAlert message={`Müşteriler okunamadı: ${error}`} onDismiss={() => setError(null)} /> : null}
      {rows === null && !error ? <p role="status" className="text-sm">Müşteriler yükleniyor.</p> : null}
      {rows?.length === 0 ? <p className="text-sm">{query ? 'Aramayla eşleşen müşteri yok.' : 'Kayıtlı müşteri yok.'}</p> : null}
      {rows && rows.length > 0 ? (
        <div className="table-wrap work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Müşteri</th><th>Telefon</th><th>Adres</th><th className="text-right">Sipariş</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><button type="button" className="min-h-12 text-left font-bold" onClick={() => setOpen(row)}>{row.name}</button></td>
                  <td className="tabular-nums whitespace-nowrap">{phoneText(row.phone)}</td>
                  <td>{row.addresses.length}</td>
                  <td className="text-right tabular-nums">{row.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {open ? (
        <PackageCustomerModal
          customer={open === 'NEW' ? null : open}
          onClose={() => setOpen(null)}
          onSaved={() => setReload((value) => value + 1)}
        />
      ) : null}
    </div>
  );
};
