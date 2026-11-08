import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { PAY_PERIODS, amountLabelOf, type PayPeriod } from '../../../lib/payPeriod';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { RuleFacts } from './RuleFacts';
import { useAuthStore } from '../../../stores/authStore';

export interface PayrollRule {
  userId: string;
  fullName: string;
  model: string;
  baseSalaryCents: number;
  hourlyRateCents: number;
  tipMultiplierPercent: number;
  payPeriod: PayPeriod;
  /** Tutar gizliyse null. */
}

export const MODELS: Record<string, string> = {
  FIXED: 'Sabit Maaş',
  TIP: 'Sabit + Bahşiş',
  HOURLY: 'Saatlik',
};

const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

/** Maaş kuralı yalnız patronda: rakam müdüre görünmez. */
export const RuleEditor: React.FC<{ userId: string; rules: PayrollRule[]; onSaved: () => Promise<void> }> = ({ userId, rules, onSaved }) => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [model, setModel] = useState('FIXED');
  const [payPeriod, setPayPeriod] = useState<PayPeriod>('MONTHLY');
  const [salary, setSalary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rule = rules.find((item) => item.userId === userId);

  useEffect(() => {
    if (!rule) return;
    setModel(rule.model);
    setPayPeriod(rule.payPeriod);
    const cents = rule.model === 'HOURLY' ? rule.hourlyRateCents : rule.baseSalaryCents;
    setSalary((cents / 100).toFixed(2).replace('.', ','));
  }, [rule]);

  const remove = async () => {
    const { actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('delete_payroll_rule', { tenantId, actorRole, userId });
      setSalary('');
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const cents = parseCents(salary);

  const save = async () => {
    const { actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('set_payroll_rule', {
        tenantId,
        actorRole,
        input: {
          userId,
          model,
          baseSalaryCents: model === 'HOURLY' ? 0 : cents,
          hourlyRateCents: model === 'HOURLY' ? cents : 0,
          // Çarpan kartta ayrı düzenlenir; kural kaydı onu sıfırlamasın.
          tipMultiplierPercent: rule?.tipMultiplierPercent ?? 100,
          payPeriod,
        },
      });
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="space-y-3">
      {rule ? (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {MODELS[rule.model] ?? rule.model}{' · '}
          {PAY_PERIODS.find((item) => item.id === rule.payPeriod)?.label}{' · '}
          {formatMoney(rule.model === 'HOURLY' ? rule.hourlyRateCents : rule.baseSalaryCents)}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">Bu kişi için maaş kuralı yok.</p>
      )}
      {isOwner ? <div className="flex flex-wrap gap-2">
        <select aria-label="Maaş modeli" className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)}>
          {Object.entries(MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select aria-label="Hakediş" className={fieldClass} value={payPeriod} onChange={(event) => setPayPeriod(event.target.value as PayPeriod)}>
          {PAY_PERIODS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2"><span className="text-sm font-semibold">{model === 'HOURLY' ? 'Saatlik ücret' : amountLabelOf(payPeriod)}</span>
          <NumberInput aria-label="Maaş" className="min-h-12 tabular-nums !w-44" value={salary} onValueChange={setSalary} />
        </label>
        <Button variant="secondary" className="min-h-12 text-sm font-bold" disabled={cents === null} onClick={() => void save()}>
          Kuralı Kaydet
        </Button>
        {rule ? (
          <Button variant="ghost" aria-label="Maaş kuralını sil" onClick={() => void remove()}>
            <Trash2 className="w-5 h-5" />
          </Button>
        ) : null}
      </div> : null}
      {error ? <ErrorToast message={error} /> : null}
      {rule ? <RuleFacts rule={rule} onSaved={onSaved} /> : null}
    </div>
  );
};
