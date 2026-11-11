import { useState } from 'react';
import { localDate } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { MAX_CALENDAR_RANGE_DAYS, RANGE_LABELS, reportPeriod, validCalendarRange, type PanoramaRange, type RangeKey } from '../../../lib/dateRange';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { MonthPicker } from '../../../ui/MonthPicker';

const RANGES: RangeKey[] = ['TODAY', 'YESTERDAY', 'WEEK', 'MONTH'];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function visibleEndDate(to: string): string {
  const end = new Date(to);
  if (to.slice(11, 19) === '00:00:00') end.setDate(end.getDate() - 1);
  return dateKey(end);
}

interface PeriodFilterProps {
  range: PanoramaRange;
  onChange: (range: PanoramaRange) => void;
}

/** Dönem seçimi segment düğmeleri olarak görünür; seçim mantığı ve tarih aralığı kuralları aynıdır. */
export function PeriodFilter({ range, onChange }: PeriodFilterProps) {
  const [showCustom, setShowCustom] = useState(typeof range === 'object' && 'from' in range);
  const [dates, setDates] = useState(() => {
    if (typeof range === 'object' && 'from' in range) return range;
    const today = localDate(new Date());
    return { from: today, to: today };
  });
  const today = localDate(new Date());
  const currentMonth = today.slice(0, 7);
  const month = typeof range === 'object' && 'month' in range ? range.month : '';
  const activeCustom = typeof range === 'object' && 'from' in range;
  const validRange = validCalendarRange(dates) && dates.to <= today;
  const applied = reportPeriod(range);
  const visibleTo = visibleEndDate(applied.to);
  const periodLabel = applied.from.slice(0, 10) === visibleTo
    ? formatDay(applied.from)
    : [formatDay(applied.from), formatDay(visibleTo)].join(' – ');

  return (
    <section aria-label="Rapor dönemi" className="period">
      <div className="seg" role="group" aria-label="Hazır dönemler">
        {RANGES.map((key) => (
          <button key={key} type="button" className="seg-btn" aria-pressed={range === key}
            onClick={() => { setShowCustom(false); onChange(key); }}>
            {RANGE_LABELS[key]}
          </button>
        ))}
        <MonthPicker value={month} current={currentMonth} className="seg-month"
          onSelect={(value) => { setShowCustom(false); onChange({ month: value }); }} />
        <button type="button" className="seg-btn" aria-pressed={activeCustom} aria-expanded={showCustom}
          aria-controls="panorama-custom-period" onClick={() => setShowCustom(!showCustom)}>
          Tarih Aralığı
        </button>
      </div>

      {showCustom && (
        <form id="panorama-custom-period" className="flex flex-wrap items-end gap-2 pt-3"
          onSubmit={(event) => { event.preventDefault(); if (validRange) onChange(dates); }}>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            Başlangıç
            <Input type="date" value={dates.from} max={dates.to || today} className="!w-auto tabular-nums"
              aria-describedby="panorama-range-limit"
              onChange={(event) => setDates({ ...dates, from: event.currentTarget.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            Bitiş
            <Input type="date" value={dates.to} min={dates.from || undefined} max={today} className="!w-auto tabular-nums"
              aria-describedby="panorama-range-limit"
              onChange={(event) => setDates({ ...dates, to: event.currentTarget.value })} />
          </label>
          <Button type="submit" variant="primary" disabled={!validRange}>Uygula</Button>
          <span id="panorama-range-limit" className="self-center text-xs text-[var(--text-secondary)]">
            En fazla {MAX_CALENDAR_RANGE_DAYS} gün seçilebilir.
          </span>
        </form>
      )}
      <p role="status" className="dash-card-sub tabular-nums">Gösterilen dönem · {periodLabel}</p>
    </section>
  );
}
