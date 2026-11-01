import React, { useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { formatDateTime, formatTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import type { ShiftSummary } from '../../types/shift';

interface MovementRow {
  id: string;
  movementType: 'IN' | 'OUT';
  amountCents: number;
  reason: string;
  createdAt: string;
}

/** Vardiya kapanış yaprağı gibi okunur: en alttaki satır çekmecede olması gereken paradır. */
export const ShiftOverview: React.FC<{ summary: ShiftSummary }> = ({ summary }) => {
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<MovementRow[]>('get_cash_movements', { shiftId: summary.shiftId, tenantId, actorRole })
      .then((rows) => {
        setMovements(rows);
        setError(null);
      })
      .catch((caught) => setError(errorText(caught)));
  }, [summary.shiftId, summary.totalCashInCents, summary.totalCashOutCents]);

  const rows: Array<[string, number]> = [
    ['Açılış nakdi', summary.openingCashCents],
    ['Nakit satış', summary.totalCashSalesCents],
    ['Para girişi', summary.totalCashInCents],
    ['Para çıkışı', -summary.totalCashOutCents],
  ];
  const otherChannels: Array<[string, number]> = [
    ['Kart', summary.totalCardSalesCents],
    ['Yemek kartı', summary.totalMealCardSalesCents],
    ['Cari', summary.totalVeresiyeCents],
  ];

  return (
    <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 min-h-full">
      <section className="slip slip-white rounded-t-md px-5 pb-5 flex flex-col mb-2">
        <div className="flex items-baseline justify-between gap-3 border-b-2 border-[var(--print)] pb-2">
          <h2 className="print-title text-3xl">Çekmece</h2>
          <span className="text-sm font-semibold text-right">
            {summary.cashierName} · {formatDateTime(summary.openedAt)}
          </span>
        </div>
        <div className="ruled flex-1 min-h-48">
          {rows.map(([label, cents]) => (
            <div key={label} className="h-12 flex items-end justify-between pb-1 text-lg">
              <span>{label}</span>
              <span className="hand text-2xl tabular-nums">{formatMoney(cents)}</span>
            </div>
          ))}
        </div>
        <div className="border-t-2 border-[var(--print)] pt-2 flex items-baseline justify-between">
          <span className="font-bold text-[var(--print)]">Çekmecede olmalı</span>
          <span className="hand text-4xl tabular-nums">{formatMoney(summary.expectedCashInDrawerCents)}</span>
        </div>
      </section>

      <div className="flex flex-col gap-4 min-w-0">
        <section className="paper p-4">
          <h3 className="print-title text-xl mb-1">Diğer tahsilatlar</h3>
          {otherChannels.map(([label, cents]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-[var(--border)] last:border-0">
              <span>{label}</span>
              <span className="font-bold tabular-nums">{formatMoney(cents)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-2 font-extrabold">
            <span>Vardiya cirosu</span>
            <span className="tabular-nums">{formatMoney(summary.totalSalesCents)}</span>
          </div>
        </section>

        <section className="paper p-4 flex-1">
          <h3 className="print-title text-xl mb-1">Kasa hareketleri</h3>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p>
          ) : movements.length === 0 ? (
            <p className="text-[var(--text-secondary)]">Bu vardiyada para girişi veya çıkışı yok.</p>
          ) : (
            movements.map((movement) => (
              <div key={movement.id} className="flex justify-between gap-3 py-1.5 border-b border-[var(--border)] last:border-0">
                <span className="min-w-0">
                  <span className="block truncate">{movement.reason}</span>
                  <span className="block text-sm text-[var(--text-muted)] tabular-nums">{formatTime(movement.createdAt)}</span>
                </span>
                <span className="font-bold tabular-nums shrink-0">
                  {movement.movementType === 'OUT' ? '-' : '+'}{formatMoney(movement.amountCents)}
                </span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
};
