import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { usePanoramaStore, type MenuMetrics } from '../../../stores/panoramaStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from './Panel';

type Target = MenuMetrics['monthly_targets'][number];

/** Ay sonu tahmini geçen gün hızından gelir; ay başında tahmin yanıltacağı için gizlenir. */
function monthEndEstimate(actualCents: number, now = new Date()): number | null {
  const day = now.getDate();
  if (day < 5) return null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((actualCents / day) * daysInMonth);
}

export const MonthlyGoal: React.FC<{ target: Target | null }> = ({ target }) => {
  const saveTarget = usePanoramaStore((state) => state.saveTarget);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(text);

  const submit = async () => {
    if (cents === null || cents <= 0) return;
    try {
      await saveTarget(cents);
      setEditing(false);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const achieved = target?.achieved_percent ?? null;
  const estimate = target ? monthEndEstimate(target.actual_cents) : null;

  return (
    <Panel
      title="Aylık Hedef"
      aside={
        <Button variant="ghost" size="sm" className="min-h-12 text-xs" onClick={() => setEditing(!editing)}>
          {target ? 'Değiştir' : 'Hedef Koy'}
        </Button>
      }
    >
      {editing ? (
        <div className="flex gap-2">
          <Input
            aria-label="Aylık ciro hedefi"
            inputMode="decimal"
            placeholder="Hedef (₺)"
            className="min-h-12 tabular-nums"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button variant="primary" className="min-h-12" disabled={cents === null || cents <= 0} onClick={() => void submit()}>
            Kaydet
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
      {target ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">%{achieved ?? 0}</span>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {formatMoney(target.actual_cents)} / {formatMoney(target.target_cents)}
            </span>
          </div>
          <div className="h-2 rounded bg-[var(--bg-subtle)] overflow-hidden">
            <div className="h-full rounded bg-[var(--accent-blue)]" style={{ width: `${Math.min(100, achieved ?? 0)}%` }} />
          </div>
          {estimate !== null ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Bu hızla ay sonu tahmini <span className="font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(estimate)}</span>
            </p>
          ) : null}
        </>
      ) : !editing ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu ay için hedef yok.</p>
      ) : null}
    </Panel>
  );
};
