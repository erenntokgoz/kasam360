import React, { useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { formatTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import type { ShiftSummary } from '../../types/shift';

interface MovementRow {
  id: string;
  movementType: 'IN' | 'OUT';
  amountCents: number;
  reason: string;
  createdAt: string;
}

/** Kasa farkının sebebi çoğu zaman bu satırlardadır; sayımdan önce görünür olmalıdır. */
export const ShiftMovements: React.FC<{ summary: ShiftSummary }> = ({ summary }) => {
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

  return (
    <div className="paper border border-[var(--border)] rounded-xl p-4 shadow-sm space-y-3">
      <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Kasa Hareketleri</h3>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p>
      ) : movements.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu vardiyada para girişi veya çıkışı yok.</p>
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
    </div>
  );
};
