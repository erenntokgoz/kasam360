import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { recentPeriods } from '../../lib/payPeriod';
import { DEFAULT_TIP_MULTIPLIER, sharesFromMultipliers } from '../../lib/tipShares';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Modal } from '../../ui/Modal';
import { RecordCard } from './RecordCard';
import { NumberInput } from '../../ui/NumberInput';
import type { PayrollRule } from './payroll/RuleEditor';

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

/** Havuz kayıtları alındığı aya yazılır; yeni bahşiş yalnız içinde bulunulan aya eklenir. */
const currentMonth = () => localDate(new Date()).slice(0, 7);

/** Bahşiş havuzu yüzdeyle dağıtılır; toplam tam %100 olmadan dağıtım yapılmaz. */
export const TipPoolPanel: React.FC<TipPoolPanelProps> = ({ canDistribute, staff }) => {
  const months = recentPeriods('MONTHLY');
  const [period, setPeriod] = useState(currentMonth());
  const isCurrent = period === currentMonth();
  const [multipliers, setMultipliers] = useState<Record<string, number> | null>(null);
  const [tips, setTips] = useState<TipSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<TipEntry[]>([]);
  const [selected, setSelected] = useState<TipEntry | null>(null);
  const [deleting, setDeleting] = useState<TipEntry | null>(null);
  const [editing, setEditing] = useState<TipEntry | null>(null);
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

  // Çarpanlar personel kartındaki maaş kuralından gelir; kuralı olmayan 1,00 sayılır.
  useEffect(() => {
    if (!canDistribute) return;
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<PayrollRule[]>('get_payroll_rules', { tenantId, actorRole })
      .then((rules) => setMultipliers(Object.fromEntries(rules.map((rule) => [rule.userId, rule.tipMultiplierPercent]))))
      .catch((caught) => setError(errorText(caught)));
  }, [canDistribute]);

  const byMultiplier = useCallback(() => {
    if (!multipliers) return;
    const shares = sharesFromMultipliers(
      staff.map((member) => ({ id: member.id, multiplier: multipliers[member.id] ?? DEFAULT_TIP_MULTIPLIER })),
    );
    setPercents(Object.fromEntries(staff.map((member) => [member.id, shares[member.id] ? String(shares[member.id]) : ''])));
  }, [multipliers, staff]);

  // İlk açılışta yüzdeler çarpandan dolar; kullanıcı değiştirdiyse üzerine yazılmaz.
  useEffect(() => {
    if (Object.keys(percents).length === 0) byMultiplier();
  }, [byMultiplier]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (editing) await invokeIPC('delete_tip_entry', { entryId: editing.id, actorId, actorRole, tenantId });
      setEditing(null);
      setAmount('');
    });
  };

  const percentOf = (id: string) => Number.parseInt(percents[id] ?? '0', 10) || 0;
  const totalPercent = useMemo(() => staff.reduce((sum, member) => sum + percentOf(member.id), 0), [staff, percents]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasEntry = staff.some((member) => (percents[member.id] ?? '').trim() !== '');

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
        <div className="flex flex-wrap gap-2">
          {months.map((item) => (
            <Button
              key={item.key}
              variant={period === item.key ? 'selected' : 'secondary'}
              className="min-h-12 text-sm tabular-nums"
              onClick={() => {
                setPeriod(item.key);
                setEditing(null);
                setAmount('');
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
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
        {isCurrent ? (
          <>
            <label className="block space-y-1"><span className="text-sm font-semibold">Bahşiş tutarı</span>
              <NumberInput aria-label="Bahşiş tutarı" pinpadTitle="Bahşiş Tutarı" value={amount} onValueChange={setAmount} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <Button variant={method === 'CASH' ? 'selected' : 'secondary'} onClick={() => setMethod('CASH')}>Nakit</Button>
              <Button variant={method === 'CARD' ? 'selected' : 'secondary'} onClick={() => setMethod('CARD')}>Kart</Button>
              <Button variant="primary" onClick={addTip}>{editing ? 'Kaydet' : 'Havuza Ekle'}</Button>
            </div>
          </>
        ) : null}
        {entries.length > 0 ? (
          <ul className="grid gap-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <RecordCard title={METHOD_LABEL[entry.paymentMethod]} description={formatDateTime(entry.createdAt)}
                  value={formatMoney(entry.amountCents)} onOpen={() => setSelected(entry)} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {canDistribute ? (
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Dağıtım Yüzdeleri</h3>
            <Button variant="secondary" disabled={!multipliers} onClick={byMultiplier}>Çarpana Göre</Button>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{member.name}</span>
                  <span className="block text-xs tabular-nums text-[var(--text-secondary)]">
                    Çarpan %{multipliers?.[member.id] ?? DEFAULT_TIP_MULTIPLIER}
                  </span>
                </span>
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
          {hasEntry ? (
            <p className={`text-sm font-bold tabular-nums ${totalPercent === 100 ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-red)]'}`}>
              Toplam %{totalPercent}{totalPercent === 100 ? '' : ' · Toplam %100 olmalı'}
            </p>
          ) : null}
          <Button variant="primary" size="lg" className="w-full" disabled={totalPercent !== 100} onClick={distribute}>
            Bahşişi Dağıt
          </Button>
        </section>
      ) : null}

      {selected ? (
        <Modal cardFlow isOpen title="Bahşiş Detayı" subtitle={formatDateTime(selected.createdAt)}
          maxWidth="sm" onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="flex justify-between gap-3 text-sm">
              <span>{METHOD_LABEL[selected.paymentMethod]}</span>
              <strong className="tabular-nums">{formatMoney(selected.amountCents)}</strong>
            </div>
            <div className="flex justify-end gap-2">
              {isCurrent ? (
                <Button type="button" onClick={() => {
                  setEditing(selected);
                  setMethod(selected.paymentMethod);
                  setAmount((selected.amountCents / 100).toFixed(2).replace('.', ','));
                  setSelected(null);
                }}>Düzenle</Button>
              ) : null}
              <Button type="button" variant="danger" onClick={() => { setDeleting(selected); setSelected(null); }}>Sil</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog cardFlow
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

      {error ? <ErrorToast message={error} /> : null}
    </div>
  );
};
