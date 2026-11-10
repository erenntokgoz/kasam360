import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';

interface ShiftRow {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  expectedAmountCents: number;
  actualAmountCents: number | null;
  differenceCents: number | null;
}

const cell = 'px-3 h-12 border-b border-[var(--border)]';

/** Kapanan günler kasadan silinmez: fark hangi gün oluştuysa orada görünür. */
export const ShiftHistory: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setRows((await invokeIPC<ShiftRow[]>('get_shift_history', { actorRole, tenantId })).filter((row) => row.closedAt));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-2">
      <h3 className="print-title text-base font-bold">Geçmiş Vardiyalar</h3>
      {error ? <><ErrorToast message={error} /><Button size="sm" onClick={() => void load()}>Tekrar Dene</Button></> : null}
      {rows === null && !error ? <p role="status" className="text-sm">Vardiya geçmişi yükleniyor.</p> : null}
      {rows?.length === 0 && !error ? <p className="text-sm">Kapanmış vardiya yok.</p> : null}
      {rows && rows.length > 0 ? (
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
                  <td className={`${cell} tabular-nums`}>{formatDateTime(row.openedAt)}</td>
                  <td className={`${cell} tabular-nums`}>{formatDateTime(row.closedAt ?? undefined)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatMoney(row.expectedAmountCents)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{row.actualAmountCents == null ? '—' : formatMoney(row.actualAmountCents)}</td>
                  <td className={`${cell} text-right tabular-nums font-bold`}>{row.differenceCents == null ? '—' : formatMoney(row.differenceCents)}</td>
                  <td className={cell}><Button size="sm" disabled={row.actualAmountCents == null} onClick={() => onSelect(row.id)}>Z Raporu</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};
