import React, { useEffect } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useExpenseStore } from '../../../stores/expenseStore';
import { BudgetPanel } from './BudgetPanel';
import { ProfitStatement } from './ProfitStatement';
import { RecurringPanel } from './RecurringPanel';

/** Kâr, bütçe ve sabit gider aylık bakılır: günlük kasadan ayrı durur. */
export const BudgetTab: React.FC = () => {
  const report = useExpenseStore((state) => state.report);
  const load = useExpenseStore((state) => state.load);
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {isOwner && report ? <ProfitStatement report={report} /> : null}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <BudgetPanel />
        <RecurringPanel />
      </div>
    </div>
  );
};
