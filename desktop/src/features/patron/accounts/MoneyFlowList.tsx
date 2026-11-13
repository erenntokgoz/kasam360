import React, { useEffect, useMemo, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDateTime } from '../../../lib/date';
import { toLocalIso } from '../../../lib/dateRange';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { ErrorToast } from '../../../ui/ErrorToast';
import { Input } from '../../../ui/Input';
import { FLOW_LABEL, type FlowEntry } from './accountsModel';

const two = (value: number) => String(value).padStart(2, '0');
const dayText = (date: Date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

/** Gün uçları yerel saatle ISO'ya çevrilir; 23:59:59 dahil. */
function bounds(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return { from: toLocalIso(new Date(fy, fm - 1, fd)), to: toLocalIso(new Date(ty, tm - 1, td, 23, 59, 59)) };
}

/** Vardiya kasası giriş-çıkışları ile hesap transferleri tek akışta. */
export const MoneyFlowList: React.FC = () => {
  const [from, setFrom] = useState(() => dayText(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(() => dayText(new Date()));
  const [entries, setEntries] = useState<FlowEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rangeError = !from || !to ? 'Başlangıç ve bitiş seçin.' : from > to ? 'Başlangıç bitişten sonra olamaz.' : null;

  useEffect(() => {
    if (rangeError) return undefined;
    let current = true;
    setEntries(null);
    setError(null);
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<FlowEntry[]>('list_money_flow', { actorRole, tenantId, ...bounds(from, to), limit: 500 })
      .then((next) => { if (current) setEntries(next); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [from, to, rangeError]);

  const totals = useMemo(() => {
    const sum = (kind: FlowEntry['kind']) => (entries ?? []).filter((entry) => entry.kind === kind).reduce((acc, entry) => acc + entry.amountCents, 0);
    return { inCents: sum('CASH_IN'), outCents: sum('CASH_OUT') };
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">Başlangıç
          <Input type="date" className="!w-44 tabular-nums" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">Bitiş
          <Input type="date" className="!w-44 tabular-nums" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {rangeError ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{rangeError}</p> : null}
      {error ? <ErrorToast message={`Nakit akışı okunamadı: ${error}`} /> : null}
      {!entries && !error && !rangeError ? <p role="status" className="text-sm">Akış yükleniyor.</p> : null}
      {entries?.length === 0 ? <p className="text-sm">Bu aralıkta hareket yok.</p> : null}
      {entries && entries.length > 0 ? (
        <>
          <div className="work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Zaman</th><th>Tür</th><th>Açıklama</th><th>İşlemi yapan</th><th className="text-right">Tutar</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
                    <td className="whitespace-nowrap tabular-nums">{formatDateTime(entry.createdAt)}</td>
                    <td>{FLOW_LABEL[entry.kind]}</td>
                    <td>{entry.description}</td>
                    <td>{entry.actorName ?? '—'}</td>
                    <td className={`text-right font-bold tabular-nums ${entry.kind === 'CASH_OUT' ? 'text-[var(--accent-red)]' : ''}`}>
                      {entry.kind === 'CASH_OUT' ? '-' : ''}{formatMoney(entry.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm font-semibold tabular-nums">Giriş {formatMoney(totals.inCents)} · Çıkış {formatMoney(totals.outCents)}</p>
        </>
      ) : null}
    </div>
  );
};
