import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { NumberInput } from '../../ui/NumberInput';

interface TipSummary {
  totalCents: number;
  distributedCents: number;
  leftoverCents: number;
}

interface TipEntry {
  id: string;
  amountCents: number;
  paymentMethod: 'CASH' | 'CARD';
  createdAt: string;
}

const METHOD_LABEL = { CASH: 'Nakit', CARD: 'Kart' };

interface TipPoolPanelProps {
  canDistribute: boolean;
  staff: { id: string; name: string }[];
}

/** Bahşiş havuzu yüzdeyle dağıtılır; toplam tam %100 olmadan dağıtım yapılmaz. */
export const TipPoolPanel: React.FC<TipPoolPanelProps> = ({ canDistribute, staff }) => {
  const period = localDate(new Date()).slice(0, 7);
  const [tips, setTips] = useState<TipSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<TipEntry[]>([]);
  const [deleting, setDeleting] = useState<TipEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setTips(await invokeIPC<TipSummary>('get_tip_pool_summary', { actorRole, tenantId, period }));
      if (canDistribute) setEntries(await invokeIPC<TipEntry[]>('list_tip_entries', { actorRole, tenantId, period }));
    } catch (caught) {
      setTips(null);
      setError(errorText(caught));
    }
  }, [period, canDistribute]);

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
      setError('Bahşiş tutarını girin.');
      return;
    }
    void run(async () => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('record_tip_entry', { amountCents, paymentMethod: method, actorId, actorRole, tenantId });
      setAmount('');
    });
  };

  const percentOf = (id: string) => Number.parseInt(percents[id] ?? '0', 10) || 0;
  const totalPercent = useMemo(() => staff.reduce((sum, member) => sum + percentOf(member.id), 0), [staff, percents]); // eslint-disable-line react-hooks/exhaustive-deps

  const splitEvenly = () => {
    if (staff.length === 0) return;
    const share = Math.floor(100 / staff.length);
    const extra = 100 - share * staff.length;
    setPercents(Object.fromEntries(staff.map((member, index) => [member.id, String(share + (index < extra ? 1 : 0))])));
  };

  const distribute = () => {
    const allocations = staff
      .map((member) => ({ userId: member.id, basisCents: 100, multiplierPercent: percentOf(member.id) }))
      .filter((allocation) => allocation.multiplierPercent > 0);
    void run(() => {
      const { actorRole, tenantId } = sessionArgs();
      return invokeIPC('distribute_tip_pool', { actorRole, tenantId, period, allocations });
    });
  };

  const money = (cents?: number) => (cents === undefined ? 'Okunamadı' : formatMoney(cents));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-4">
        <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Bahşiş Havuzu · {period}</h3>
        <div className="grid grid-cols-3 gap-3 text-sm text-[var(--text-primary)]">
          <div>
            <span className="text-sm text-[var(--text-secondary)] block">Toplanan</span>
            <span className="text-lg font-bold tabular-nums">{money(tips?.totalCents)}</span>
          </div>
          <div>
            <span className="text-sm text-[var(--text-secondary)] block">Dağıtılan</span>
            <span className="text-lg font-bold tabular-nums">{money(tips?.distributedCents)}</span>
          </div>
          <div>
            <span className="text-sm text-[var(--text-secondary)] block">Kalan</span>
            <span className="text-lg font-bold tabular-nums">{money(tips?.leftoverCents)}</span>
          </div>
        </div>
        <NumberInput aria-label="Bahşiş tutarı" placeholder="Bahşiş tutarı (₺)" pinpadTitle="Bahşiş Tutarı" value={amount} onValueChange={setAmount} />
        <div className="grid grid-cols-3 gap-2">
          <Button variant={method === 'CASH' ? 'selected' : 'secondary'} onClick={() => setMethod('CASH')}>Nakit</Button>
          <Button variant={method === 'CARD' ? 'selected' : 'secondary'} onClick={() => setMethod('CARD')}>Kart</Button>
          <Button variant="primary" onClick={addTip}>Havuza Ekle</Button>
        </div>
        {entries.length > 0 ? (
          <ul className="divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate tabular-nums text-[var(--text-secondary)]">{formatDateTime(entry.createdAt)} · {METHOD_LABEL[entry.paymentMethod]}</span>
                <span className="font-bold tabular-nums">{formatMoney(entry.amountCents)}</span>
                <Button variant="ghost" aria-label="Bahşişi sil" onClick={() => setDeleting(entry)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {canDistribute ? (
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Dağıtım Yüzdeleri</h3>
            <Button variant="secondary" onClick={splitEvenly}>Eşit Böl</Button>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-semibold truncate">{member.name}</span>
                <span className="text-sm tabular-nums text-[var(--text-secondary)]">
                  {tips ? formatMoney(Math.floor((tips.totalCents * percentOf(member.id)) / 100)) : ''}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-bold">%</span>
                  <NumberInput
                    aria-label={`${member.name} bahşiş yüzdesi`}
                    kind="integer"
                    className="!w-24"
                    value={percents[member.id] ?? ''}
                    onValueChange={(text) => setPercents({ ...percents, [member.id]: text })}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p className={`text-sm font-bold tabular-nums ${totalPercent === 100 ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-red)]'}`}>
            Toplam %{totalPercent}{totalPercent === 100 ? '' : ' · Toplam %100 olmalı'}
          </p>
          <Button variant="primary" size="lg" className="w-full" disabled={totalPercent !== 100} onClick={distribute}>
            Bahşişi Dağıt
          </Button>
        </section>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Bahşiş silinsin mi?"
          message={formatMoney(deleting.amountCents)}
          onConfirm={async () => {
            const { actorId, actorRole, tenantId } = sessionArgs();
            await invokeIPC('delete_tip_entry', { entryId: deleting.id, actorId, actorRole, tenantId });
            await load();
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {error ? <p role="alert" className="lg:col-span-2 text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </div>
  );
};
