import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { canAnimate, gsap, useGSAP } from '../../../lib/dashMotion';
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

const RING_SIZE = 112;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Hedef halkası: doluluk yüzdeden gelir, yüzde sayısı ortada yazılıdır. */
const GoalRing: React.FC<{ percent: number }> = ({ percent }) => {
  const root = useRef<HTMLDivElement>(null);
  const filled = Math.min(100, Math.max(0, percent));
  const offset = RING_LENGTH * (1 - filled / 100);
  // Halka boş başlayıp dolar; hareket kapalıyken son durum doğrudan yazılıdır.
  useGSAP(() => {
    if (!canAnimate()) return;
    gsap.from('.goal-ring-fill', { strokeDashoffset: RING_LENGTH, duration: 1.1, ease: 'power2.out' });
  }, { scope: root, dependencies: [offset], revertOnUpdate: true });
  return (
    <div ref={root} className="goal-ring" role="img" aria-label={`Hedefin yüzde ${percent} kadarı tamamlandı`}>
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
        <circle className="goal-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} strokeWidth={RING_STROKE} fill="none" />
        <circle
          className="goal-ring-fill"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <span className="goal-ring-value tabular-nums">%{percent}</span>
    </div>
  );
};

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
      title="Aylık Hedef"
      subtitle={`${monthLabel}${rangeSelected ? '' : ' · seçili tarih aralığından bağımsız'}`}
      aside={isOwner && isCurrentMonth && displayedTarget !== undefined ? (
        <button
          type="button"
          className="card-icon-btn"
          aria-label={editing ? 'Vazgeç' : displayedTarget ? 'Hedefi değiştir' : 'Hedef koy'}
          title={editing ? 'Vazgeç' : displayedTarget ? 'Hedefi değiştir' : 'Hedef koy'}
          onClick={() => {
            setEditing(!editing);
            setSaveError(null);
            setText(displayedTarget ? centsToText(displayedTarget.target_cents) : '');
          }}
        >
          <Pencil className="w-5 h-5" aria-hidden />
        </button>
      ) : null}
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
        <div className="goal-body">
          <GoalRing percent={achieved ?? 0} />
          <dl className="goal-facts">
            <div><dt>Gerçekleşen</dt><dd className="tabular-nums">{formatMoney(displayedTarget.actual_cents)}</dd></div>
            <div><dt>Hedef</dt><dd className="tabular-nums">{formatMoney(displayedTarget.target_cents)}</dd></div>
            {estimate !== null ? <div><dt>Ay sonu tahmini</dt><dd className="tabular-nums">{formatMoney(estimate)}</dd></div> : null}
          </dl>
        </div>
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
