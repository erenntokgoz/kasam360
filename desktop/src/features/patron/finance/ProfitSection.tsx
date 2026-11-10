import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { monthKey, useExpenseStore } from '../../../stores/expenseStore';
import { MonthPicker } from '../../../ui/MonthPicker';
import { ExpenseBreakdown, MonthlyTrend } from './ExpenseBreakdown';
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-secondary)]">Ay</span>
        <MonthPicker value={period} current={monthKey()} onSelect={setPeriod} />
      </div>
      {error ? (
        <><p className="text-sm text-[var(--text-secondary)]">Kâr ve giderler okunamadı.</p><ErrorToast message={`Kâr ve giderler okunamadı: ${error}`} /></>
      ) : null}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          {isOwner && report ? <ProfitStatement report={report} /> : null}
          {isOwner && report ? <ExpenseBreakdown rows={report.expensesByCategory ?? []} totalCents={report.totalExpensesCents} /> : null}
        </div>
        <div className="space-y-4">
          <RecurringPanel />
          {isOwner && report ? <MonthlyTrend rows={report.monthlyTrend ?? []} /> : null}
        </div>
      </div>
    </div>
  );
};
