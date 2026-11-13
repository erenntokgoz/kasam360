import React, { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { formatDateTime } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { formatNumber } from '../../../lib/numberText';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';

interface DayCloseRow {
  id: string;
  closedAt: string;
  closedByName: string | null;
  totalRevenueCents: number;
  totalOrders: number;
  closedShiftsCount: number;
}

interface DayCloseDetail {
  header: DayCloseRow;
  periodStart: string | null;
  cashCents: number;
  cardCents: number;
  mealCardCents: number;
  veresiyeCents: number;
  refundCents: number;
  cashInCents: number;
  cashOutCents: number;
  shifts: { shiftId: string; cashierName: string | null; openedAt: string; closedAt: string | null; expectedCents: number; actualCents: number | null; differenceCents: number | null }[];
}

/** Sayım yapılmayan vardiyada fark bilinmez; sıfır gösterilmez. */
const money = (cents: number | null) => (cents === null ? '—' : formatMoney(cents));

const Line: React.FC<{ label: string; cents: number; bold?: boolean }> = ({ label, cents, bold }) => (
  <div className={`flex justify-between gap-3 ${bold ? 'border-t border-[var(--border)] pt-1 font-bold' : ''}`}>
    <dt>{label}</dt><dd className="tabular-nums">{formatMoney(cents)}</dd>
  </div>
);

/** Kapatılmış günlerin arşivi: kapanış listesi, seçilen günün dökümü ve yazdırma. */
export const DayCloseArchive: React.FC = () => {
  const [rows, setRows] = useState<DayCloseRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayCloseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      const next = await invokeIPC<DayCloseRow[]>('list_day_closes', { actorRole, tenantId, limit: 200 });
      setRows(next);
      setSelectedId((current) => current ?? next[0]?.id ?? null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    setDetail(null);
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<DayCloseDetail>('get_day_close_detail', { actorRole, tenantId, closeId: selectedId })
      .then((next) => { if (current) setDetail(next); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [selectedId]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section aria-label="Kapanan günler" className="work-surface rounded-lg border border-[var(--border)]">
        {error ? <div className="space-y-2 p-4"><ErrorToast message={error} /><Button onClick={() => void loadList()}>Tekrar Dene</Button></div> : null}
        {rows === null && !error ? <p role="status" className="p-4 text-sm">Gün sonları yükleniyor.</p> : null}
        {rows?.length === 0 ? <p className="p-4 text-sm">Henüz kapatılmış gün yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {rows?.map((row) => (
            <li key={row.id}>
              <button type="button" aria-pressed={row.id === selectedId} onClick={() => setSelectedId(row.id)}
                className={`flex w-full min-h-14 items-center justify-between gap-3 px-4 py-2 text-left hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] ${row.id === selectedId ? 'bg-[var(--bg-hover)]' : ''}`}>
                <span>
                  <span className="block text-sm font-bold tabular-nums">{formatDateTime(row.closedAt)}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">{row.closedByName ?? '—'} · {formatNumber(row.totalOrders)} adisyon</span>
                </span>
                <span className="text-sm font-bold tabular-nums">{formatMoney(row.totalRevenueCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Gün sonu dökümü" className="work-surface space-y-4 rounded-lg border border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
          <h2 className="print-title text-base font-bold">Gün Sonu Raporu</h2>
          <Button variant="primary" disabled={!detail} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" /><span>Yazdır</span>
          </Button>
        </div>
        {!selectedId && rows?.length ? <p className="text-sm">Bir gün seçin.</p> : null}
        {selectedId && !detail && !error ? <p role="status" className="text-sm">Döküm yükleniyor.</p> : null}
        {detail ? (
          <div className="receipt-paper space-y-3 text-sm">
            <div className="border-b border-dashed border-[var(--border-strong)] pb-2 text-center">
              <div className="font-bold">Gün sonu (kapanış)</div>
              <div className="text-xs tabular-nums text-[var(--text-secondary)]">
                {detail.periodStart ? `${formatDateTime(detail.periodStart)} - ` : 'İlk kapanış · '}{formatDateTime(detail.header.closedAt)} · {detail.header.closedByName ?? '—'}
              </div>
            </div>
            <dl className="space-y-1.5">
              <Line label="Nakit tahsilat" cents={detail.cashCents} />
              <Line label="Kredi kartı" cents={detail.cardCents} />
              <Line label="Yemek kartı" cents={detail.mealCardCents} />
              <Line label="Veresiye" cents={detail.veresiyeCents} />
              <Line label="Toplam ciro" cents={detail.header.totalRevenueCents} bold />
              <Line label="İade" cents={detail.refundCents} />
              <Line label="Kasa girişleri" cents={detail.cashInCents} />
              <Line label="Kasa çıkışları ve giderler" cents={detail.cashOutCents} />
              <div className="flex justify-between gap-3"><dt>Kapanan adisyon</dt><dd className="tabular-nums">{formatNumber(detail.header.totalOrders)}</dd></div>
            </dl>
            <div>
              <h3 className="mb-1 font-bold">Vardiyalar</h3>
              {detail.shifts.length === 0 ? <p>Bu dönemde kapanan vardiya yok.</p> : (
                <ul className="divide-y divide-[var(--border)]">
                  {detail.shifts.map((shift) => (
                    <li key={shift.shiftId} className="flex flex-wrap justify-between gap-x-3 py-2">
                      <span>{shift.cashierName ?? '—'} · <span className="tabular-nums">{formatDateTime(shift.openedAt)}</span></span>
                      <span className="tabular-nums">Beklenen {formatMoney(shift.expectedCents)} · Sayılan {money(shift.actualCents)} · Fark {money(shift.differenceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};
