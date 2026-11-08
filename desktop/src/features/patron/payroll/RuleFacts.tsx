import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { hoursText } from '../../../lib/payPeriod';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { NumberInput } from '../../../ui/NumberInput';
import { useAuthStore } from '../../../stores/authStore';
import type { PayrollRule } from './RuleEditor';

interface HourlyEarnings {
  period: string;
  from: string;
  to: string;
  workedSeconds: number;
  hourlyRateCents: number | null;
  earnedCents: number | null;
}

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{value}</dd>
  </div>
);

/** Kural altında kişinin saat karşılığı, bu dönem hak edişi ve bahşiş çarpanı. */
export const RuleFacts: React.FC<{ rule: PayrollRule; onSaved: () => Promise<void> }> = ({ rule, onSaved }) => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [earnings, setEarnings] = useState<HourlyEarnings | null>(null);
  const [multiplier, setMultiplier] = useState(String(rule.tipMultiplierPercent));
  const [error, setError] = useState<string | null>(null);
  const isHourly = rule.model === 'HOURLY';

  useEffect(() => {
    setMultiplier(String(rule.tipMultiplierPercent));
  }, [rule.tipMultiplierPercent]);

  useEffect(() => {
    if (!isHourly) {
      setEarnings(null);
      return;
    }
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<HourlyEarnings>('get_hourly_earnings', { tenantId, actorRole, userId: rule.userId })
      .then(setEarnings)
      .catch((caught) => setError(errorText(caught)));
  }, [isHourly, rule.userId, rule.hourlyRateCents, rule.payPeriod]);

  const percent = multiplier.trim() === '' ? null : Number(multiplier);
  const validMultiplier = percent !== null && Number.isInteger(percent) && percent >= 0 && percent <= 500;

  const saveMultiplier = async () => {
    const { actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('set_tip_multiplier', { tenantId, actorRole, userId: rule.userId, tipMultiplierPercent: percent });
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-3">
      <dl className="grid grid-cols-2 gap-3">
        {isHourly ? (
          earnings ? (
            <>
              <Fact label={`Bu dönem çalışılan · ${formatDay(earnings.from)} - ${formatDay(earnings.to)}`} value={`${hoursText(earnings.workedSeconds)} saat`} />
            </>
          ) : null
        ) : null}
      </dl>
      {isOwner ? <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Bahşiş çarpanı (%)
          <NumberInput
            kind="integer"
            aria-label="Bahşiş çarpanı"
            className="min-h-12 mt-1 tabular-nums !w-28"
            value={multiplier}
            onValueChange={setMultiplier}
          />
        </label>
        <Button
          variant="secondary"
          className="min-h-12 text-sm font-bold"
          disabled={!validMultiplier || percent === rule.tipMultiplierPercent}
          onClick={() => void saveMultiplier()}
        >
          Çarpanı Kaydet
        </Button>
      </div> : null}
      {error ? <ErrorToast message={error} /> : null}
    </div>
  );
};
