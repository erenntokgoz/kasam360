import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { formatNumber } from '../../lib/numberText';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { Input } from '../../ui/Input';
import { ClosedOrderDetailModal } from './ClosedOrderDetailModal';
import {
  METHOD_OPTIONS, SORT_OPTIONS, buildFilter, defaultQuery, methodSummary, moveQuery, queryRange,
  type ClosedOrderList, type ClosedOrderMethod, type ClosedOrderQuery, type ClosedOrderSort,
} from './closedOrdersModel';

interface StaffOption {
  id: string;
  name: string;
  role: string;
}

const PAGE_SIZE = 50;
const selectClass = 'min-h-12 rounded-full border border-[var(--border)] bg-[var(--glass-tint)] px-4 text-sm text-[var(--text-primary)]';
const fieldLabel = 'flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]';

/** Kapanmış adisyonlar: tarih-saat, yöntem, masa ve kullanıcı filtreleriyle arama; satır adisyon dökümünü açar. */
export const ClosedOrdersTab: React.FC = () => {
  const [query, setQuery] = useState<ClosedOrderQuery>(() => defaultQuery());
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ClosedOrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const range = useMemo(() => queryRange(query), [query]);
  const rangeError = 'error' in range ? range.error : null;
  const update = (patch: Partial<ClosedOrderQuery>) => { setQuery((current) => ({ ...current, ...patch })); setPage(0); };

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<StaffOption[]>('get_staff', { actorRole, tenantId, includeInactive: true })
      .then((rows) => setStaff(rows.filter((member) => member.role !== 'MASTER')))
      .catch((caught) => setError(errorText(caught)));
  }, []);

  useEffect(() => {
    if ('error' in range) return undefined;
    let current = true;
    setResult(null);
    setError(null);
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<ClosedOrderList>('list_closed_orders', { actorRole, tenantId, filter: buildFilter(query, range, page * PAGE_SIZE, PAGE_SIZE) })
      .then((next) => { if (current) setResult(next); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [query, range, page]);

  const pageCount = result ? Math.max(1, Math.ceil(result.summary.count / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabel}>Başlangıç
          <span className="flex gap-2">
            <Input type="date" className="!w-40 tabular-nums" value={query.fromDate} onChange={(event) => update({ fromDate: event.target.value })} />
            <Input type="time" className="!w-28 tabular-nums" aria-label="Başlangıç saati" value={query.fromTime} onChange={(event) => update({ fromTime: event.target.value })} />
          </span>
        </label>
        <label className={fieldLabel}>Bitiş
          <span className="flex gap-2">
            <Input type="date" className="!w-40 tabular-nums" value={query.toDate} onChange={(event) => update({ toDate: event.target.value })} />
            <Input type="time" className="!w-28 tabular-nums" aria-label="Bitiş saati" value={query.toTime} onChange={(event) => update({ toTime: event.target.value })} />
          </span>
        </label>
        <div className="flex gap-2">
          <Button onClick={() => { setQuery(moveQuery(query, -1)); setPage(0); }}><ChevronLeft size={16} aria-hidden="true" />Önceki Gün</Button>
          <Button onClick={() => { setQuery(moveQuery(query, 1)); setPage(0); }}>Sonraki Gün<ChevronRight size={16} aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={fieldLabel}>Ödeme yöntemi
          <select className={selectClass} value={query.method} onChange={(event) => update({ method: event.target.value as ClosedOrderMethod })}>
            {METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Masa adı
          <Input type="search" className="!w-44" value={query.tableSearch} onChange={(event) => update({ tableSearch: event.target.value })} />
        </label>
        <label className={fieldLabel}>Açan
          <select className={selectClass} value={query.openedBy} onChange={(event) => update({ openedBy: event.target.value })}>
            <option value="">Herkes</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Kapatan
          <select className={selectClass} value={query.closedBy} onChange={(event) => update({ closedBy: event.target.value })}>
            <option value="">Herkes</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>Sıralama
          <select className={selectClass} value={query.sort} onChange={(event) => update({ sort: event.target.value as ClosedOrderSort })}>
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      {rangeError ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{rangeError}</p> : null}
      {error ? <><p className="text-sm text-[var(--text-secondary)]">Kapanan masalar okunamadı.</p><ErrorToast message={`Kapanan masalar okunamadı: ${error}`} /></> : null}
      {!result && !error && !rangeError ? <p role="status" className="text-sm">Kapanan masalar yükleniyor.</p> : null}
      {result?.rows.length === 0 ? <p className="text-sm">Bu filtrede kapanmış masa yok.</p> : null}

      {result && result.rows.length > 0 ? (
        <div className="work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Masa</th><th>Açılış</th><th>Kapanış</th><th>Açan</th><th>Kapatan</th><th>Yöntem</th><th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.orderId} className="cursor-pointer" onClick={() => setSelected(row.orderId)}>
                  <td>
                    <button type="button" className="min-h-12 text-left font-bold focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
                      onClick={(event) => { event.stopPropagation(); setSelected(row.orderId); }}>
                      {row.tableName}
                    </button>
                  </td>
                  <td className="tabular-nums whitespace-nowrap">{formatDateTime(row.openedAt)}</td>
                  <td className="tabular-nums whitespace-nowrap">{formatDateTime(row.closedAt)}</td>
                  <td>{row.openedByName ?? '—'}</td>
                  <td>{row.closedByName ?? '—'}</td>
                  <td>{methodSummary(row)}</td>
                  <td className="text-right font-bold tabular-nums">{formatMoney(row.paidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">
          {result ? `${formatNumber(result.summary.count)} adisyon · ${formatMoney(result.summary.paidCents)}` : '—'}
        </p>
        <nav aria-label="Sayfalar" className="flex items-center gap-2">
          <Button disabled={page === 0 || !result} onClick={() => setPage(page - 1)}>Önceki</Button>
          <span className="tabular-nums">{page + 1} / {pageCount}</span>
          <Button disabled={!result || page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Sonraki</Button>
        </nav>
      </div>

      {selected ? <ClosedOrderDetailModal orderId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
};
