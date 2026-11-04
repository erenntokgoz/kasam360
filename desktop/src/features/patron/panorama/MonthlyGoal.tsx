import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { centsToText, parseCents } from '../../../lib/moneyInput';
import { useAuthStore } from '../../../stores/authStore';
import { usePanoramaStore } from '../../../stores/panoramaStore';
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
export const MonthlyGoal: React.FC = () => {
  const { target, targetError, loadTarget, saveTarget } = usePanoramaStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cents = parseCents(text);

  useEffect(() => {
    void loadTarget();
  }, [loadTarget]);

  const submit = async () => {
    if (cents === null || cents <= 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveTarget(cents);
      setEditing(false);
    } catch (caught) {
      setSaveError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const achieved = target?.achieved_percent ?? null;
  const estimate = target ? monthEndEstimate(target.actual_cents) : null;

  return (
    <Panel
      title="Aylık Hedef"
      aside={
        isOwner && target !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-12 text-sm"
            onClick={() => {
              setEditing(!editing);
              setSaveError(null);
              setText(target ? centsToText(target.target_cents) : '');
            }}
          >
            {editing ? 'Vazgeç' : target ? 'Değiştir' : 'Hedef Koy'}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <div className="flex gap-2">
          <NumberInput
            aria-label="Aylık ciro hedefi"
            placeholder="Hedef (₺)"
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
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          Hedef kaydedilemedi: {saveError}
        </p>
      ) : null}
      {targetError ? (
        <div className="flex items-center justify-between gap-2">
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            Hedef okunamadı: {targetError}
          </p>
          <Button variant="secondary" className="min-h-12 text-sm" onClick={() => void loadTarget()}>
            Tekrar Dene
          </Button>
        </div>
      ) : target === undefined ? (
        <p className="text-sm text-[var(--text-secondary)]">Hedef okunuyor…</p>
      ) : target ? (
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
