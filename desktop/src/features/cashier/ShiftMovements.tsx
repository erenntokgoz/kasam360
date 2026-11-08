import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { formatTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import type { ShiftSummary } from '../../types/shift';

interface MovementRow {
  id: string;
  movementType: 'IN' | 'OUT';
  amountCents: number;
  reason: string;
  createdAt: string;
}

const cell = 'px-4 py-3 border-b border-[var(--border)]';
const amount = `${cell} text-right tabular-nums font-bold`;

const cleanReason = (reason: string) => reason.replace(/^İşletme Gideri \([A-Z_]+\): /, 'Gider: ');

/**
 * Defter açılışla başlar, kasa hareketleri saat sırasıyla gelir; nakit satışlar en sonda
 * tek satırda toplanır. Satış satırı başa konunca saati sonraki hareketlerin bakiyesi yanlış akıyordu.
 * Kör sayımda kasiyer beklenen tutarı görmemelidir; `blind` bakiyeyi ve satış toplamını gizler.
 */
export const ShiftMovements: React.FC<{ summary: ShiftSummary; blind?: boolean }> = ({ summary, blind = false }) => {
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<MovementRow[]>('get_cash_movements', { shiftId: summary.shiftId, tenantId, actorRole })
      .then((rows) => {
        setMovements([...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        setError(null);
      })
      .catch((caught) => setError(errorText(caught)));
  }, [summary.shiftId, summary.totalCashInCents, summary.totalCashOutCents]);

  const recent = movements.slice(-5).reverse();
  let balance = summary.openingCashCents;

  return (
    <div className="paper border border-[var(--border)] rounded-xl shadow-sm overflow-x-auto">
      {error ? <ErrorToast message={error} /> : null}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <h3 className="font-semibold">{expanded ? 'Vardiya Kasa Giriş/Çıkışları' : 'Kasa Giriş/Çıkışları'}</h3>
        <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Son Hareketler' : 'Tüm Defter'}
        </Button>
      </header>
      {!expanded ? (
        recent.length ? (
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {recent.map((movement) => (
              <li key={movement.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm">
                <time className="tabular-nums text-[var(--text-secondary)]">{formatTime(movement.createdAt)}</time>
                <span className="break-words">{cleanReason(movement.reason)}</span>
                <span className="font-semibold tabular-nums">
                  {movement.movementType === 'IN' ? '+' : '−'}{formatMoney(movement.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        ) : !error && <p className="px-4 pb-3 text-sm text-[var(--text-secondary)]">Elle kasa giriş/çıkışı yok.</p>
      ) : <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className={`${cell} w-24`}>Saat</th>
            <th className={cell}>Açıklama</th>
            <th className={`${cell} w-36 text-right`}>Giren</th>
            <th className={`${cell} w-36 text-right`}>Çıkan</th>
            {blind ? null : <th className={`${cell} w-40 text-right`}>Bakiye</th>}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${cell} tabular-nums`}>{formatTime(summary.openedAt)}</td>
            <td className={cell}>Kasa açılışı</td>
            <td className={amount}>{formatMoney(summary.openingCashCents)}</td>
            <td className={amount} />
            {blind ? null : <td className={amount}>{formatMoney(summary.openingCashCents)}</td>}
          </tr>
          {movements.map((movement) => {
            const isIn = movement.movementType === 'IN';
            balance += isIn ? movement.amountCents : -movement.amountCents;
            return (
              <tr key={movement.id}>
                <td className={`${cell} tabular-nums`}>{formatTime(movement.createdAt)}</td>
                <td className={cell}>{cleanReason(movement.reason)}</td>
                <td className={amount}>{isIn ? formatMoney(movement.amountCents) : ''}</td>
                <td className={amount}>{isIn ? '' : formatMoney(movement.amountCents)}</td>
                {blind ? null : <td className={amount}>{formatMoney(balance)}</td>}
              </tr>
            );
          })}
          {blind || summary.totalCashSalesCents == null ? null : (
            <tr>
              <td className={cell} />
              <td className={cell}>Nakit satışlar</td>
              <td className={amount}>{formatMoney(summary.totalCashSalesCents)}</td>
              <td className={amount} />
              <td className={amount}>{formatMoney(balance + summary.totalCashSalesCents)}</td>
            </tr>
          )}
        </tbody>
      </table>}
    </div>
  );
};
