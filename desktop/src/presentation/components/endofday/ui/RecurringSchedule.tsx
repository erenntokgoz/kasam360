import React from 'react';
import { Repeat, Printer } from 'lucide-react';
import { formatCurrency } from '../helpers';
import { DueBadge, DueState } from './DueBadge';

// get_recurring_expenses yaniti (backend/src/ledger_commands/budget.rs)
export interface RecurringDue {
  id: string;
  title: string;
  category: string;
  amountCents: number;
  frequency: string;
  dueDay: number;
  daysInMonth: number;
  isOverdue: boolean;
  isDueToday: boolean;
}

interface RecurringScheduleProps {
  items: RecurringDue[];
  onPrint: (item: RecurringDue) => void;
}

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: 'Aylik',
  WEEKLY: 'Haftalik',
  YEARLY: 'Yillik',
  DAILY: 'Gunluk',
};

/** Vade durumu rozet durumuna eslenir. Renk tek basina bilgi tasimaz. */
export const resolveDueState = (item: RecurringDue): { state: DueState; label: string } => {
  if (item.isOverdue) {
    return { state: 'OVERDUE', label: 'Gecikti' };
  }
  if (item.isDueToday) {
    return { state: 'DUE_TODAY', label: 'Bugun Vadesi' };
  }
  return { state: 'UPCOMING', label: 'Yaklasan Vade' };
};

/**
 * Tekrarlayan gider takvimi.
 * dueDay backend'de ay sonu sikistirmasiyla gelir (31 -> 28/29/30),
 * frontend yeniden hesaplamaz.
 */
export const RecurringSchedule: React.FC<RecurringScheduleProps> = ({ items, onPrint }) => {
  if (items.length === 0) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <Repeat size={18} />
          </div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">Tekrarlayan Islemler</h2>
        </div>
        <p className="text-sm dark:text-zinc-400 text-zinc-500 mt-3">Tanimli tekrarlayan gider bulunmuyor.</p>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
          <Repeat size={18} />
        </div>
        <div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">Tekrarlayan Islemler</h2>
          <p className="text-xs dark:text-zinc-400 text-zinc-500">
            Ay sonu vade sikistirmasi backend&apos;de uygulanir (ornek: 31 -&gt; 28/29/30)
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map((item) => {
          const { state, label } = resolveDueState(item);
          return (
            <div
              key={item.id}
              data-testid={`recurring-${item.id}`}
              className="p-3.5 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold dark:text-white text-zinc-900 truncate">{item.title}</p>
                <p className="text-[11px] dark:text-zinc-400 text-zinc-500">
                  {item.category} &bull; {FREQUENCY_LABEL[item.frequency] ?? item.frequency} &bull;{' '}
                  <span data-testid={`recurring-due-${item.id}`}>
                    Ayin {item.dueDay}. gunu (bu ay {item.daysInMonth} gun)
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900">
                  {formatCurrency(item.amountCents)}
                </span>
                <DueBadge state={state} label={label} />
                <button
                  type="button"
                  onClick={() => onPrint(item)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 text-xs font-medium border dark:border-white/15 border-black/10 transition-colors cursor-pointer shadow-sm"
                  title="Tekrarlayan gideri yazdir"
                >
                  <Printer size={13} />
                  <span>Yazdir</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RecurringSchedule;
