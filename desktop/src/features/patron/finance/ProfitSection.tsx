import React, { useEffect } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useExpenseStore } from '../../../stores/expenseStore';
import { Input } from '../../../ui/Input';
import { ProfitStatement } from './ProfitStatement';
import { RecurringPanel } from './RecurringPanel';

/** Kâr ve sabit gider aylık bakılır: günlük kasadan ayrı durur, ay tek yerden seçilir. */
export const ProfitSection: React.FC = () => {
  const { report, period, setPeriod, error, load } = useExpenseStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
        Ay
        <Input type="month" className="min-h-12 !w-44 tabular-nums" value={period} onChange={(event) => setPeriod(event.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Kâr ve giderler okunamadı: {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {isOwner && report ? <ProfitStatement report={report} /> : null}
        <RecurringPanel />
      </div>
    </div>
  );
};
