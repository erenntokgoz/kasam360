import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { useAuthStore } from '../../../stores/authStore';
import { currentMonth, usePanoramaStore } from '../../../stores/panoramaStore';
import { Button } from '../../../ui/Button';
import { Panel } from './Panel';

/** Ay sonu tahmini geçen gün hızından gelir; ay başında tahmin yanıltacağı için gizlenir. */
function monthEndEstimate(actualCents: number, now = new Date()): number | null {
  const day = now.getDate();
  if (day < 5) return null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((actualCents / day) * daysInMonth);
}

/**
 * Hedef panodan ayrı okunur: menü analizi ya da pano hata verse de hedef görünür.
 * Hedef işletme politikasıdır; yalnız sahip değiştirir, diğer roller okur.
 */
export const MonthlyGoal: React.FC<{ month: string; rangeSelected: boolean }> = ({ month, rangeSelected }) => {
  const { target, targetMonth, targetError, loadTarget, saveTarget } = usePanoramaStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const isCurrentMonth = month === currentMonth();
  const displayedTarget = targetMonth === month ? target : undefined;
  const displayedError = targetMonth === month ? targetError : null;
  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T00:00:00`));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cents = parseCents(text);

  useEffect(() => {
    setEditing(false);
    setText('');
    setSaveError(null);
    void loadTarget(month);
  }, [loadTarget, month]);

  const submit = async () => {
    if (cents === null || cents <= 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveTarget(cents, month);
      setEditing(false);
    } catch (caught) {
      setSaveError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const achieved = displayedTarget?.achieved_percent ?? null;
  const estimate = displayedTarget && isCurrentMonth ? monthEndEstimate(displayedTarget.actual_cents) : null;

  return (
    <Panel
      title={`Aylık Hedef · ${monthLabel}`}
      aside={(
        <div className="flex items-center gap-2">
          {!rangeSelected ? <span className="text-xs text-[var(--text-muted)]">Seçili tarih aralığından bağımsız</span> : null}
          {isOwner && isCurrentMonth && displayedTarget !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-12 text-sm"
              onClick={() => {
                setEditing(!editing);
                setSaveError(null);
                setText(displayedTarget ? centsToText(displayedTarget.target_cents) : '');
              }}
            >
              {editing ? 'Vazgeç' : displayedTarget ? 'Değiştir' : 'Hedef Koy'}
            </Button>
          ) : null}
        </div>
      )}
    >
      {editing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Hedef</span>
          <NumberInput
            aria-label="Aylık ciro hedefi"
            className="min-h-12 tabular-nums"
            value={text}
            onValueChange={setText}
          />
          <Button variant="primary" className="min-h-12" disabled={saving || cents === null || cents <= 0} onClick={() => void submit()}>
            Kaydet
          </Button>
        </div>
      ) : null}
      {saveError ? (
        <ErrorToast message={`Hedef kaydedilemedi: ${saveError}`} />
      ) : null}
      {displayedError ? (
        <div className="flex items-center justify-between gap-2">
          <><p className="text-sm text-[var(--text-secondary)]">Hedef okunamadı.</p><ErrorToast message={`Hedef okunamadı: ${displayedError}`} /></>
          <Button variant="secondary" className="min-h-12 text-sm" onClick={() => void loadTarget(month)}>
            Tekrar Dene
          </Button>
        </div>
      ) : displayedTarget === undefined ? (
        <p className="text-sm text-[var(--text-secondary)]">Hedef okunuyor…</p>
      ) : displayedTarget ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">%{achieved ?? 0}</span>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {formatMoney(displayedTarget.actual_cents)} / {formatMoney(displayedTarget.target_cents)}
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
        <p className="text-sm text-[var(--text-secondary)]">
          {isCurrentMonth
            ? `${monthLabel} için hedef tanımlanmamış.`
            : `${monthLabel} için hedef tanımlanmamış. Geçmiş ay hedefi sonradan eklenemez.`}
        </p>
      ) : null}
    </Panel>
  );
};
