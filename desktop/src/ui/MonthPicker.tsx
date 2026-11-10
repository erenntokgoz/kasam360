import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';

const MONTH_NAME = new Intl.DateTimeFormat('tr-TR', { month: 'long' });
const MONTH_YEAR = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });

/** `2026-11` → `Kasım 2026`. Geçersiz değer boş metin verir; ekranda uydurma ay görünmez. */
export function monthLabel(value: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return '';
  return MONTH_YEAR.format(new Date(Number(value.slice(0, 4)), Number(value.slice(5)) - 1, 1));
}

interface YearGroup { year: number; months: { value: string; name: string }[] }

/** Bugünden geriye `monthsBack` ay, yıl yıl gruplanır; gelecek ay hiç sunulmaz. */
export function monthGroups(current: string, monthsBack: number): YearGroup[] {
  const endYear = Number(current.slice(0, 4));
  const endMonth = Number(current.slice(5)) - 1;
  const groups: YearGroup[] = [];
  for (let back = 0; back <= monthsBack; back += 1) {
    const index = endYear * 12 + endMonth - back;
    const year = Math.floor(index / 12);
    const month = index % 12;
    if (groups.length === 0 || groups[groups.length - 1].year !== year) groups.push({ year, months: [] });
    groups[groups.length - 1].months.push({
      value: `${year}-${String(month + 1).padStart(2, '0')}`,
      name: MONTH_NAME.format(new Date(year, month, 1)),
    });
  }
  return groups;
}

interface MonthPickerProps {
  /** Seçili ay (`YYYY-MM`); boşsa düğme güncel ayı gösterir ama seçili sayılmaz. */
  value: string;
  /** Güncel ay; bundan sonrası seçilemez. */
  current: string;
  onSelect: (month: string) => void;
  monthsBack?: number;
  className?: string;
}

/** Düğme ay adını taşır; açılan liste yıl ayrımlıdır ve en yeni yıl üstte durur. */
export function MonthPicker({ value, current, onSelect, monthsBack = 35, className }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const groups = useMemo(() => monthGroups(current, monthsBack), [current, monthsBack]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn('relative', className)}>
      <Button ref={trigger} type="button" variant={value ? 'selected' : 'secondary'} aria-haspopup="true"
        aria-expanded={open} aria-controls={listId} aria-pressed={Boolean(value)} onClick={() => setOpen(!open)}>
        {monthLabel(value || current)}
      </Button>
      {open ? (
        <div id={listId} role="group" aria-label="Ay seçimi"
          className="paper absolute left-0 top-full z-30 mt-2 max-h-96 w-80 max-w-[90vw] space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-lg">
          {groups.map((group) => (
            <section key={group.year} aria-label={String(group.year)}>
              <h3 className="mb-1 text-xs font-bold tabular-nums text-[var(--text-secondary)]">{group.year}</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {[...group.months].reverse().map((month) => (
                  <Button key={month.value} type="button" size="sm" variant={month.value === value ? 'selected' : 'secondary'}
                    aria-pressed={month.value === value} aria-label={monthLabel(month.value)}
                    onClick={() => { setOpen(false); onSelect(month.value); }}>
                    {month.name}
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
