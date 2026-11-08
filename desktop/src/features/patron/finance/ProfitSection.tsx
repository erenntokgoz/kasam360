import { ErrorToast } from '../../../ui/ErrorToast';
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
        <><p className="text-sm text-[var(--text-secondary)]">Kâr ve giderler okunamadı.</p><ErrorToast message={`Kâr ve giderler okunamadı: ${error}`} /></>
      ) : null}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {isOwner && report ? <ProfitStatement report={report} /> : null}
        <RecurringPanel />
      </div>
    </div>
  );
};
