import React, { useState } from 'react';
import { NumberInput } from '../../../ui/NumberInput';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';

export interface PayrollRule {
  userId: string;
  fullName: string;
  model: string;
  baseSalaryCents: number;
  commissionPercent: number;
  hourlyRateCents: number;
}

const MODELS: Record<string, string> = {
  FIXED: 'Sabit Maaş',
  COMMISSION: 'Sabit + Komisyon',
  TIP: 'Sabit + Bahşiş',
  HOURLY: 'Saatlik',
  PROFIT_SHARE: 'Sabit + Kâr Payı',
};

const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

/** Maaş kuralı yalnız patronda: rakam müdüre görünmez. */
export const RuleEditor: React.FC<{ userId: string; rules: PayrollRule[]; onSaved: () => Promise<void> }> = ({ userId, rules, onSaved }) => {
  const [model, setModel] = useState('FIXED');
  const [salary, setSalary] = useState('');
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rule = rules.find((item) => item.userId === userId);

  const cents = parseCents(salary);
  const rate = percent.trim() === '' ? 0 : Number(percent);
  const ready = cents !== null && Number.isInteger(rate) && rate >= 0 && rate <= 100;

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
          commissionPercent: model === 'COMMISSION' ? rate : 0,
          hourlyRateCents: model === 'HOURLY' ? cents : 0,
          tipMultiplierPercent: 100,
          profitSharePercent: model === 'PROFIT_SHARE' ? rate : 0,
        },
      });
      setSalary('');
      setPercent('');
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="space-y-2">
      {rule ? (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {MODELS[rule.model] ?? rule.model}{' · '}
          {formatMoney(rule.model === 'HOURLY' ? rule.hourlyRateCents : rule.baseSalaryCents)}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">Bu kişi için maaş kuralı yok.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Maaş modeli" className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)}>
          {Object.entries(MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <NumberInput aria-label="Maaş" placeholder={model === 'HOURLY' ? 'Saatlik ücret (₺)' : 'Aylık maaş (₺)'} className="min-h-12 tabular-nums !w-44" value={salary} onValueChange={setSalary} />
        {model === 'COMMISSION' || model === 'PROFIT_SHARE' ? (
          <NumberInput kind="integer" aria-label="Yüzde" placeholder="Yüzde" className="min-h-12 tabular-nums !w-24" value={percent} onValueChange={setPercent} />
        ) : null}
        <Button variant="secondary" className="min-h-12 text-sm font-bold" disabled={!ready} onClick={() => void save()}>
          Kuralı Kaydet
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </div>
  );
};
