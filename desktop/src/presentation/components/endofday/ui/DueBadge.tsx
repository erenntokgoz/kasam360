import React from 'react';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

export type DueState = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'CLEARED';

interface DueBadgeProps {
  state: DueState;
  label: string;
  daysLate?: number;
}

/**
 * Vade rozeti. AGENTS.md 3.2 gereği emoji yasaktır; durum yalnizca
 * renkle anlatilmaz, metin + Lucide ikon birlikte bilgi tasir.
 */
export const DueBadge: React.FC<DueBadgeProps> = ({ state, label, daysLate }) => {
  if (state === 'OVERDUE') {
    return (
      <span
        data-testid="due-badge"
        data-state="OVERDUE"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
      >
        <AlertTriangle size={13} />
        <span>{daysLate && daysLate > 0 ? `${label} (${daysLate} gun gecikti)` : label}</span>
      </span>
    );
  }

  if (state === 'DUE_TODAY') {
    return (
      <span
        data-testid="due-badge"
        data-state="DUE_TODAY"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
      >
        <Clock size={13} />
        <span>{label}</span>
      </span>
    );
  }

  if (state === 'CLEARED') {
    return (
      <span
        data-testid="due-badge"
        data-state="CLEARED"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
      >
        <CheckCircle2 size={13} />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      data-testid="due-badge"
      data-state="UPCOMING"
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium dark:bg-white/[0.06] bg-black/[0.04] dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/[0.08]"
    >
      <Clock size={13} />
      <span>{label}</span>
    </span>
  );
};

export default DueBadge;
