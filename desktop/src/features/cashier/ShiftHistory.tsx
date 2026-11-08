import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';

interface ShiftRow {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  expected_amount_cents: number;
  actual_amount_cents: number | null;
  difference_cents: number | null;
}

const cell = 'px-3 py-2 border-b border-[var(--border)]';

/** Kapanan günler kasadan silinmez: fark hangi gün oluştuysa orada görünür. */
export const ShiftHistory: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<ShiftRow[]>('get_shift_history', { actorRole, tenantId })
      .then((list) => setRows(list.filter((row) => row.closed_at)))
      .catch((caught) => setError(errorText(caught)));
  }, []);

  return (
    <div className="space-y-2">
      <h3 className="print-title text-sm font-bold">Geçmiş Vardiyalar</h3>
      {error ? <ErrorToast message={error} /> : null}
      {rows.length === 0 && !error ? <p className="text-sm">Kapanmış vardiya yok.</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={cell}>Açılış</th>
                <th className={cell}>Kapanış</th>
                <th className={`${cell} text-right`}>Açılış Nakdi</th>
                <th className={`${cell} text-right`}>Sayılan</th>
                <th className={`${cell} text-right`}>Fark</th>
                <th className={cell}>Rapor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={`${cell} tabular-nums`}>{formatDateTime(row.opened_at)}</td>
                  <td className={`${cell} tabular-nums`}>{formatDateTime(row.closed_at ?? undefined)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatMoney(row.expected_amount_cents)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{row.actual_amount_cents == null ? '—' : formatMoney(row.actual_amount_cents)}</td>
                  <td className={`${cell} text-right tabular-nums font-bold`}>{row.difference_cents == null ? '—' : formatMoney(row.difference_cents)}</td>
                  <td className={cell}><Button size="sm" disabled={row.actual_amount_cents == null} onClick={() => onSelect(row.id)}>Z Raporu</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};
