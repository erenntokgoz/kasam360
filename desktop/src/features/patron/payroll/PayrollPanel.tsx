import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Panel } from '../panorama/Panel';
import type { PayrollRule } from './RuleEditor';

interface Amounts {
  baseCents: number;
  commissionCents: number;
  tipCents: number;
  hourlyCents: number;
  profitShareCents: number;
  deductionCents: number;
  netCents: number;
}

interface PayrollRun {
  id: string;
  fullName: string;
  amounts: Amounts | null;
  warning: string | null;
}

const two = (value: number) => String(value).padStart(2, '0');

/** Bu ay ve önceki iki ay: bordro çoğunlukla geçen ay için hesaplanır. */
function recentPeriods(now = new Date()): string[] {
  return [0, 1, 2].map((back) => {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
  });
}

const COLUMNS: { label: string; key: keyof Amounts }[] = [
  { label: 'Sabit', key: 'baseCents' },
  { label: 'Komisyon', key: 'commissionCents' },
  { label: 'Bahşiş', key: 'tipCents' },
  { label: 'Saatlik', key: 'hourlyCents' },
  { label: 'Kâr Payı', key: 'profitShareCents' },
  { label: 'Kesinti', key: 'deductionCents' },
  { label: 'Net', key: 'netCents' },
];

export const PayrollPanel: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const periods = recentPeriods();
  const [period, setPeriod] = useState(periods[1]);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loadRules = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      setRules(await invokeIPC<PayrollRule[]>('get_payroll_rules', { tenantId, actorRole }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const calculate = async () => {
    const { actorRole, tenantId } = sessionArgs();
    setIsBusy(true);
    setError(null);
    try {
      setRuns(await invokeIPC<PayrollRun[]>('run_payroll', { tenantId, actorRole, period }));
    } catch (caught) {
      setRuns(null);
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const total = runs?.reduce((sum, run) => sum + (run.amounts?.netCents ?? 0), 0) ?? 0;

  return (
    <Panel title="Bordro">
      {rules.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Maaş kuralı kişi kartından tanımlanır.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {periods.map((item) => (
          <Button
            key={item}
            variant={period === item ? 'primary' : 'secondary'}
            className="min-h-12 text-xs tabular-nums"
            onClick={() => {
              setPeriod(item);
              setRuns(null);
            }}
          >
            {item}
          </Button>
        ))}
        <Button variant="primary" className="min-h-12 text-xs font-bold" isLoading={isBusy} disabled={rules.length === 0} onClick={() => void calculate()}>
          Bordroyu Hesapla
        </Button>
        {runs && isOwner ? (
          <span className="ml-auto text-sm text-[var(--text-secondary)]">
            Ödenecek toplam <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(total)}</span>
          </span>
        ) : null}
      </div>
      {runs && isOwner ? <p className="text-xs text-[var(--text-muted)]">SGK ve vergi kesintisi dahil değildir; yasal bordroyu mali müşavir hesaplar.</p> : null}
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      {runs ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="font-medium py-2 pr-4">Personel</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="font-medium py-2 pl-4 text-right">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-4">
                    <span className="block font-semibold text-[var(--text-primary)]">{run.fullName}</span>
                    {run.warning ? <span className="block text-xs text-[var(--accent-amber)]">{run.warning}</span> : null}
                  </td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className={`py-2 pl-4 text-right tabular-nums whitespace-nowrap ${column.key === 'netCents' ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {run.amounts ? formatMoney(run.amounts[column.key]) : 'Gizli'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
};
