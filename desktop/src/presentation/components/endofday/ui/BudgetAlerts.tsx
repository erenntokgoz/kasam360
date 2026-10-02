import React from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { formatCurrency } from '../helpers';

// get_budget_status yaniti (backend/src/ledger_commands/budget.rs)
export interface BudgetStatus {
  category: string;
  monthlyLimitCents: number;
  spentCents: number;
  remainingCents: number;
  usedPercent: number;
  isExceeded: boolean;
  isNearLimit: boolean;
}

interface BudgetAlertsProps {
  items: BudgetStatus[];
}

/**
 * Kategori bütçesi uyarı şeridi.
 * AGENTS.md 3.4: asim durumunda kalan bakiye gizlenmez, negatif olarak gosterilir.
 */
export const BudgetAlerts: React.FC<BudgetAlertsProps> = ({ items }) => {
  if (items.length === 0) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <Wallet size={18} />
          </div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">Kategori Butce Denetimi</h2>
        </div>
        <p className="text-sm dark:text-zinc-400 text-zinc-500 mt-3">
          Bu ay icin tanimli kategori butce limiti bulunmuyor.
        </p>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
          <Wallet size={18} />
        </div>
        <h2 className="text-base font-semibold dark:text-white text-zinc-900">Kategori Butce Denetimi</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const tone = item.isExceeded
            ? 'text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10'
            : item.isNearLimit
            ? 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10'
            : 'text-zinc-600 dark:text-zinc-400 border-black/[0.08] dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03]';

          return (
            <div
              key={item.category}
              data-testid={`budget-${item.category}`}
              className={`p-4 rounded-2xl border ${tone}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{item.category}</p>
                {(item.isExceeded || item.isNearLimit) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                    <AlertTriangle size={12} />
                    {item.isExceeded ? 'Limit Asildi' : 'Limit Yaklasiyor'}
                  </span>
                )}
              </div>

              <p className="text-lg font-semibold tabular-nums mt-1">{formatCurrency(item.spentCents)}</p>
              <p className="text-[11px] opacity-80">
                Limit {formatCurrency(item.monthlyLimitCents)} &bull; Kullanim %{item.usedPercent}
              </p>

              <div className="w-full h-1.5 rounded-full dark:bg-white/[0.08] bg-black/[0.06] mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    item.isExceeded ? 'bg-red-500' : item.isNearLimit ? 'bg-amber-500' : 'bg-[#007AFF]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, item.usedPercent))}%` }}
                />
              </div>

              {/* Asimda kalan bakiye negatif gosterilir; asla gizlenmez */}
              <p
                data-testid={`budget-remaining-${item.category}`}
                className={`text-[11px] font-medium mt-1 tabular-nums ${
                  item.remainingCents < 0 ? 'text-red-600 dark:text-red-400' : ''
                }`}
              >
                Kalan: {formatCurrency(item.remainingCents)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BudgetAlerts;
