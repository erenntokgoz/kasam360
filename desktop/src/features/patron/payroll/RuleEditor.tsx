import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';

export interface PayrollRule {
  userId: string;
  fullName: string;
  model: string;
  baseSalaryCents: number;
  commissionPercent: number;
  hourlyRateCents: number;
}

interface StaffRow {
  id: string;
  name: string;
  is_active?: boolean;
  isActive?: boolean;
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
export const RuleEditor: React.FC<{ rules: PayrollRule[]; onSaved: () => Promise<void> }> = ({ rules, onSaved }) => {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState('FIXED');
  const [salary, setSalary] = useState('');
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId, includeInactive: false })
      .then((rows) => {
        setStaff(rows);
        setUserId((current) => current || rows[0]?.id || '');
      })
      .catch((caught) => setError(errorText(caught)));
  }, []);

  const cents = parseCents(salary);
  const rate = percent.trim() === '' ? 0 : Number(percent);
  const ready = userId !== '' && cents !== null && Number.isInteger(rate) && rate >= 0 && rate <= 100;

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
      {rules.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {rules.map((rule) => (
            <li key={rule.userId} className="px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs">
              <span className="font-semibold text-[var(--text-primary)]">{rule.fullName}</span>
              <span className="text-[var(--text-secondary)] tabular-nums">
                {' · '}{MODELS[rule.model] ?? rule.model}{' · '}
                {formatMoney(rule.model === 'HOURLY' ? rule.hourlyRateCents : rule.baseSalaryCents)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">Bordro için önce personele maaş kuralı tanımlayın.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Personel" className={fieldClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
          {staff.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
        <select aria-label="Maaş modeli" className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)}>
          {Object.entries(MODELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <Input aria-label="Maaş" inputMode="decimal" placeholder={model === 'HOURLY' ? 'Saatlik ücret (₺)' : 'Aylık maaş (₺)'} className="min-h-12 tabular-nums !w-44" value={salary} onChange={(event) => setSalary(event.target.value)} />
        {model === 'COMMISSION' || model === 'PROFIT_SHARE' ? (
          <Input aria-label="Yüzde" inputMode="numeric" placeholder="Yüzde" className="min-h-12 tabular-nums !w-24" value={percent} onChange={(event) => setPercent(event.target.value)} />
        ) : null}
        <Button variant="secondary" className="min-h-12 text-xs font-bold" disabled={!ready} onClick={() => void save()}>
          Kuralı Kaydet
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </div>
  );
};
