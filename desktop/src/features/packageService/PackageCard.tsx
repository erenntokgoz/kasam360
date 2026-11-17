import React, { useState } from 'react';
import { Clock, MapPin, Phone } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/formatMoney';
import {
  NEXT_LABEL, PAYMENT_LABEL, durationText, lateMinutes, minutesSince, nextStatus, orderCode, phoneText, stageStart,
} from '../../lib/packageModel';
import type { PackageCourier, PackageDelivery, PackageStatus } from '../../types/packageService';
import { Button } from '../../ui/Button';

interface PackageCardProps {
  row: PackageDelivery;
  now: number;
  couriers: PackageCourier[];
  /** Personel her adımı, kurye yalnız kendi siparişinde yola çıkma ve teslimi görür. */
  mode: 'STAFF' | 'COURIER';
  isBusy: boolean;
  onAdvance: (to: PackageStatus, courierId?: string) => void;
  onAssign: (courierId: string) => void;
  onCancel: () => void;
}

const selectClass = 'min-h-12 w-full rounded-full border border-[var(--border)] bg-[var(--glass-tint)] px-4 text-sm text-[var(--text-primary)]';

/** Tek paket siparişi: adres, süre ve o aşamada yapılabilecek işlem. Geciken sipariş kırmızı çerçevelenir. */
export const PackageCard: React.FC<PackageCardProps> = ({ row, now, couriers, mode, isBusy, onAdvance, onAssign, onCancel }) => {
  const [picked, setPicked] = useState(row.courierId ?? '');
  const late = lateMinutes(row, now);
  const next = nextStatus(row);
  const active = couriers.filter((courier) => courier.isCourier);
  const total = durationText(minutesSince(row.createdAt, now));
  const stage = durationText(minutesSince(stageStart(row), now));
  const staff = mode === 'STAFF';
  // Kurye "Hazır" kararını veremez; sıradaki adım ona ait değilse düğme çıkmaz.
  const canStep = next !== null && (staff || next !== 'READY');
  const needsCourier = staff && next === 'ON_ROUTE';

  return (
    <article
      aria-label={`Paket ${orderCode(row.id)} ${row.customerName}`}
      className={cn(
        'work-surface rounded-2xl border p-4 space-y-3',
        late !== null ? 'border-[var(--accent-red)]' : 'border-[var(--border)]',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-base leading-snug break-words">{row.customerName}</p>
          <a href={`tel:${row.phone}`} className="inline-flex min-h-12 items-center gap-1.5 text-sm tabular-nums text-[var(--text-secondary)]">
            <Phone className="size-4" aria-hidden="true" />{phoneText(row.phone)}
          </a>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--text-secondary)]">#{orderCode(row.id)}</span>
      </header>

      <p className="flex items-start gap-1.5 text-sm break-words">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{row.addressText}{row.directions ? ` — ${row.directions}` : ''}</span>
      </p>
      <p className="text-sm text-[var(--text-secondary)] break-words">{row.itemsSummary}</p>
      {row.note ? <p className="text-sm font-semibold break-words">Not: {row.note}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-bold tabular-nums">{formatMoney(row.totalCents)}</span>
        <span className="text-[var(--text-secondary)]">{PAYMENT_LABEL[row.paymentMethod]}</span>
      </div>
      <p className={cn('flex items-center gap-1.5 text-sm tabular-nums', late !== null ? 'font-bold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]')}>
        <Clock className="size-4" aria-hidden="true" />
        <span>Toplam {total} · bu aşamada {stage}</span>
        {late !== null ? <span>· {durationText(late)} gecikti</span> : null}
      </p>
      {row.courierName ? <p className="text-sm">Kurye: <strong>{row.courierName}</strong></p> : null}
      {row.status === 'DELIVERED' && row.settledAt === null && row.paymentMethod !== 'ONLINE' ? (
        <p className="text-sm font-semibold">Para kuryeden teslim alınacak.</p>
      ) : null}

      {staff && (row.status === 'READY' || row.status === 'ON_ROUTE') ? (
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Kurye
          <select
            className={cn(selectClass, 'mt-1')}
            value={picked}
            disabled={isBusy}
            onChange={(event) => {
              setPicked(event.target.value);
              if (event.target.value && row.status === 'ON_ROUTE') onAssign(event.target.value);
            }}
          >
            <option value="">Kurye seçin</option>
            {active.map((courier) => <option key={courier.userId} value={courier.userId}>{courier.name}</option>)}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canStep && next ? (
          <Button
            variant="primary"
            className="flex-1"
            disabled={isBusy || (needsCourier && !picked)}
            onClick={() => onAdvance(next, needsCourier ? picked : undefined)}
          >
            {NEXT_LABEL[next]}
          </Button>
        ) : null}
        {staff && (row.status === 'PREPARING' || row.status === 'READY' || row.status === 'ON_ROUTE') ? (
          <Button variant="danger" disabled={isBusy} onClick={onCancel}>İptal</Button>
        ) : null}
      </div>
    </article>
  );
};
