import React, { useMemo, useState } from 'react';
import { BOARD_COLUMNS, STATUS_LABEL } from '../../lib/packageModel';
import { usePackageStore } from '../../stores/packageStore';
import type { PackageDelivery } from '../../types/packageService';
import { InlineAlert } from '../../ui/InlineAlert';
import { CancelPackageModal } from './CancelPackageModal';
import { PackageCard } from './PackageCard';

interface PackageBoardProps {
  now: number;
  mode: 'STAFF' | 'COURIER';
}

/**
 * Durum sütunlu tahta. Okuma hatası ve işlem hatası kalıcıdır: hata varken boş sütun "iş yok"
 * anlamına gelmesin diye uyarı sütunların üstünde kapatılana kadar durur.
 */
export const PackageBoard: React.FC<PackageBoardProps> = ({ now, mode }) => {
  const { rows, couriers, loadError, actionError, isBusy, advance, assignCourier, dismissActionError, load } = usePackageStore();
  const [cancelling, setCancelling] = useState<PackageDelivery | null>(null);

  const columns = useMemo(
    () => BOARD_COLUMNS.map((status) => ({
      status,
      items: rows.filter((row) => row.status === status && (status !== 'DELIVERED' || row.settledAt === null)),
    })),
    [rows],
  );
  const closed = useMemo(() => rows.filter((row) => row.status === 'CANCELLED' || row.settledAt !== null), [rows]);
  const isEmpty = rows.length === 0 && !loadError;

  return (
    <div className="space-y-4">
      {loadError ? <InlineAlert message={`Paket siparişleri okunamadı: ${loadError}`} /> : null}
      {actionError ? <InlineAlert message={actionError} onDismiss={dismissActionError} /> : null}
      {isEmpty ? <p role="status" className="text-sm text-[var(--text-secondary)]">Açık paket siparişi yok.</p> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))] items-start">
        {columns.map((column) => (
          <section key={column.status} aria-label={STATUS_LABEL[column.status]} className="space-y-3">
            <h2 className="flex items-center justify-between text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              <span>{STATUS_LABEL[column.status]}</span>
              <span className="tabular-nums">{column.items.length}</span>
            </h2>
            {column.items.map((row) => (
              <PackageCard
                key={row.id}
                row={row}
                now={now}
                couriers={couriers}
                mode={mode}
                isBusy={isBusy}
                onAdvance={(to, courierId) => void advance(row.id, to, courierId)}
                onAssign={(courierId) => void assignCourier(row.id, courierId)}
                onCancel={() => setCancelling(row)}
              />
            ))}
          </section>
        ))}
      </div>

      {closed.length > 0 ? (
        <section aria-label="Kapananlar" className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)]">Son kapananlar</h2>
          <ul className="divide-y">
            {closed.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-semibold">{row.customerName}</span>
                <span className="text-[var(--text-secondary)]">
                  {STATUS_LABEL[row.status]}{row.cancelReason ? ` — ${row.cancelReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cancelling ? (
        <CancelPackageModal delivery={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void load(); }} />
      ) : null}
    </div>
  );
};
