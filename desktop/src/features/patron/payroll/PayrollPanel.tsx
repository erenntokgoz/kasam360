import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { PAY_PERIODS, hoursText, recentPeriods, type PayPeriod } from '../../../lib/payPeriod';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { NumberInput } from '../../../ui/NumberInput';
import { Panel } from '../panorama/Panel';
import type { PayrollRule } from './RuleEditor';

interface Amounts {
  baseCents: number;
  tipCents: number;
  hourlyCents: number;
  deductionCents: number;
  netCents: number;
}

interface PayrollRun {
  id: string;
  fullName: string;
  model: string;
  workedSeconds: number;
  amounts: Amounts | null;
  warning: string | null;
  paidCents: number;
  remainingCents: number;
}

const COLUMNS: { label: string; key: keyof Amounts }[] = [
  { label: 'Sabit', key: 'baseCents' },
  { label: 'Bahşiş', key: 'tipCents' },
  { label: 'Saatlik', key: 'hourlyCents' },
  { label: 'Kesinti', key: 'deductionCents' },
  { label: 'Net', key: 'netCents' },
];

export const PayrollPanel: React.FC = () => {
  const canViewAmounts = useAuthStore((state) => ['OWNER', 'MANAGER'].includes(state.user?.role ?? ''));
  const [payPeriod, setPayPeriod] = useState<PayPeriod>('MONTHLY');
  const periods = recentPeriods(payPeriod);
  // Aylık bordro çoğunlukla geçen ay için hesaplanır; gün ve hafta içinde bulunandır.
  const [period, setPeriod] = useState(periods[1].key);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<PayrollRun | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');

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
      setRuns(await invokeIPC<PayrollRun[]>('run_payroll', { tenantId, actorRole, payPeriod, period }));
    } catch (caught) {
      setRuns(null);
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const hasHourly = runs?.some((run) => run.model === 'HOURLY') ?? false;
  const total = runs?.reduce((sum, run) => sum + (run.amounts?.netCents ?? 0), 0) ?? 0;
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');

  const savePayment = async () => {
    if (!paymentTarget) return;
    const cents = parseCents(paymentAmount);
    if (cents === null || cents <= 0 || cents > paymentTarget.remainingCents) {
      setError('Ödeme tutarı kalan bordro borcunu aşamaz.');
      return;
    }
    const { actorId, actorRole, tenantId } = sessionArgs();
    setIsBusy(true);
    try {
      await invokeIPC('pay_payroll_run', {
        tenantId, actorId, actorRole, payrollRunId: paymentTarget.id,
        amountCents: cents, paymentMethod,
      });
      setPaymentTarget(null);
      setPaymentAmount('');
      await calculate();
    } catch (caught) { setError(errorText(caught)); }
    finally { setIsBusy(false); }
  };

  return (
    <Panel title="Bordro">
      <div className="flex flex-wrap items-center gap-2">
        {PAY_PERIODS.map((item) => (
          <Button
            key={item.id}
            variant={payPeriod === item.id ? 'primary' : 'secondary'}
            className="min-h-12 text-sm font-bold"
            onClick={() => {
              setPayPeriod(item.id);
              setPeriod(recentPeriods(item.id)[item.id === 'MONTHLY' ? 1 : 0].key);
              setRuns(null);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {periods.map((item) => (
          <Button
            key={item.key}
            variant={period === item.key ? 'selected' : 'secondary'}
            className="min-h-12 text-sm tabular-nums"
            onClick={() => {
              setPeriod(item.key);
              setRuns(null);
            }}
          >
            {item.label}
          </Button>
        ))}
        <Button variant="primary" className="min-h-12 text-sm font-bold" isLoading={isBusy} disabled={rules.length === 0} onClick={() => void calculate()}>
          Bordroyu Hesapla
        </Button>
        {runs && canViewAmounts ? (
          <span className="ml-auto text-sm text-[var(--text-secondary)]">
            Ödenecek toplam <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(total)}</span>
          </span>
        ) : null}
      </div>
      {runs && canViewAmounts ? <p className="text-xs text-[var(--text-muted)]">SGK ve vergi kesintisi dahil değildir; yasal bordroyu mali müşavir hesaplar.</p> : null}
      {error ? <ErrorToast message={error} /> : null}
      {runs ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="font-medium py-2 pr-4">Personel</th>
                {hasHourly ? <th className="font-medium py-2 pl-4 text-right">Saat</th> : null}
                {COLUMNS.map((column) => (
                  <th key={column.key} className="font-medium py-2 pl-4 text-right">{column.label}</th>
                ))}
                {canViewAmounts ? <><th className="font-medium py-2 pl-4 text-right">Ödenen</th><th className="font-medium py-2 pl-4 text-right">Kalan</th></> : null}
                {isOwner ? <th className="font-medium py-2 pl-4 text-right">İşlem</th> : null}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-4">
                    <span className="block font-semibold text-[var(--text-primary)]">{run.fullName}</span>
                    {run.warning ? <span className="block text-xs text-[var(--accent-amber)]">{run.warning}</span> : null}
                  </td>
                  {hasHourly ? (
                    <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                      {run.model === 'HOURLY' ? hoursText(run.workedSeconds) : '-'}
                    </td>
                  ) : null}
                  {COLUMNS.map((column) => (
                    <td key={column.key} className={`py-2 pl-4 text-right tabular-nums whitespace-nowrap ${column.key === 'netCents' ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {run.amounts ? formatMoney(run.amounts[column.key]) : 'Gizli'}
                    </td>
                  ))}
                  {canViewAmounts ? <>
                    <td className="py-2 pl-4 text-right tabular-nums">{formatMoney(run.paidCents)}</td>
                    <td className="py-2 pl-4 text-right tabular-nums font-semibold">{formatMoney(run.remainingCents)}</td>
                  </> : null}
                  {isOwner ? <td className="py-2 pl-4 text-right">
                    {run.remainingCents > 0 ? <Button type="button" variant="secondary" className="min-h-10 text-xs" onClick={() => { setPaymentTarget(run); setPaymentAmount((run.remainingCents / 100).toFixed(2).replace('.', ',')); }}>Ödeme kaydet</Button> : <span>Tamamlandı</span>}
                  </td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {paymentTarget ? <div role="dialog" aria-modal="true" aria-label="Bordro ödemesi" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
        <div className="w-full max-w-sm rounded-xl bg-[var(--bg-surface)] p-4 space-y-3">
          <h3 className="font-semibold">{paymentTarget.fullName} · kalan {formatMoney(paymentTarget.remainingCents)}</h3>
          <label className="block text-sm">Ödeme tutarı
            <NumberInput aria-label="Ödeme tutarı" className="mt-1 min-h-12" value={paymentAmount} onValueChange={setPaymentAmount} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={paymentMethod === 'CASH' ? 'selected' : 'secondary'} onClick={() => setPaymentMethod('CASH')}>Nakit</Button>
            <Button type="button" variant={paymentMethod === 'BANK_TRANSFER' ? 'selected' : 'secondary'} onClick={() => setPaymentMethod('BANK_TRANSFER')}>Havale</Button>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">Kısmi ödeme kalan bordro borcunu azaltır. Nakit, açık vardiya kasasından düşer.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setPaymentTarget(null)}>Vazgeç</Button>
            <Button type="button" variant="primary" isLoading={isBusy} onClick={() => void savePayment()}>Ödemeyi kaydet</Button>
          </div>
        </div>
      </div> : null}
    </Panel>
  );
};
