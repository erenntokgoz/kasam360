import React, { useCallback, useEffect, useState } from 'react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

interface TipSummary {
  totalCents: number;
  distributedCents: number;
  leftoverCents: number;
}

interface TipPoolPanelProps {
  canDistribute: boolean;
  staffIds: string[];
  shares: Record<string, string>;
}

/** Nakit bahşiş havuzu. Pay girilmeyen personel dağıtıma girmez. */
export const TipPoolPanel: React.FC<TipPoolPanelProps> = ({ canDistribute, staffIds, shares }) => {
  const period = localDate(new Date()).slice(0, 7);
  const [tips, setTips] = useState<TipSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setTips(await invokeIPC<TipSummary>('get_tip_pool_summary', { actorRole, tenantId, period }));
    } catch (caught) {
      setTips(null);
      setError(errorText(caught));
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const addTip = () => {
    const amountCents = parseCents(amount);
    if (!amountCents) {
      setError('Bahşiş tutarını rakamla girin.');
      return;
    }
    void run(async () => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('record_tip_entry', { amountCents, actorId, actorRole, tenantId });
      setAmount('');
    });
  };

  const distribute = () => {
    const allocations = staffIds
      .map((userId) => ({ userId, basisCents: 100, multiplierPercent: Number(shares[userId] ?? '0') }))
      .filter((allocation) => allocation.multiplierPercent > 0);
    void run(() => {
      const { actorRole, tenantId } = sessionArgs();
      return invokeIPC('distribute_tip_pool', { actorRole, tenantId, period, allocations });
    });
  };

  const money = (cents?: number) => (cents === undefined ? 'Okunamadı' : formatMoney(cents));

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
      <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Bahşiş havuzu · {period}</h3>
      <div className="grid grid-cols-3 gap-3 text-sm text-[var(--text-primary)]">
        <div>
          <span className="text-xs text-[var(--text-secondary)] block">Toplanan</span>
          <span className="font-bold tabular-nums">{money(tips?.totalCents)}</span>
        </div>
        <div>
          <span className="text-xs text-[var(--text-secondary)] block">Dağıtılan</span>
          <span className="font-bold tabular-nums">{money(tips?.distributedCents)}</span>
        </div>
        <div>
          <span className="text-xs text-[var(--text-secondary)] block">Kalan</span>
          <span className="font-bold tabular-nums">{money(tips?.leftoverCents)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Nakit bahşiş tutarı"
          inputMode="decimal"
          placeholder="Nakit bahşiş (₺)"
          className="min-h-12"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button variant="secondary" className="min-h-12 shrink-0" onClick={addTip}>
          Havuza Ekle
        </Button>
      </div>
      {canDistribute ? (
        <Button variant="primary" className="w-full min-h-12" onClick={distribute}>
          Bahşişi Dağıt
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
    </section>
  );
};
