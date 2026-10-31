import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { toLocalIso } from '../../../lib/dateRange';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  isActive?: boolean;
}

interface PlanRow {
  id: string;
  userName: string;
  planDate: string;
  startTime: string;
  endTime: string;
  roleRequired: string;
  status: string;
}

const WINDOW_DAYS = 14;
const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';
const dayOffset = (days: number) => toLocalIso(new Date(Date.now() + days * 86_400_000)).slice(0, 10);

/** Önümüzdeki iki hafta: plan kasadaki vardiyadan ayrıdır, kimin geleceğini gösterir. */
export const ShiftPlanPanel: React.FC = () => {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(dayOffset(0));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [rows, nextPlans] = await Promise.all([
        invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId, includeInactive: false }),
        invokeIPC<PlanRow[]>('list_shift_plans', { actorRole, tenantId, from: dayOffset(0), to: dayOffset(WINDOW_DAYS) }),
      ]);
      setStaff(rows);
      setPlans(nextPlans);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    const person = staff.find((row) => row.id === userId);
    if (!person) return;
    setError(null);
    try {
      await invokeIPC('add_shift_plan', {
        actorId, actorRole, tenantId,
        plan: { userId, planDate: date, startTime: start, endTime: end, plannedBreakMinutes: 0, roleRequired: person.role, station: null },
      });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Panel title="Vardiya Planı">
      {plans.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Önümüzdeki iki hafta için plan yok.</p> : null}
      <ul className="flex flex-col">
        {plans.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center gap-3 min-h-12 py-1 border-b border-[var(--border)] last:border-b-0">
            <span className="tabular-nums text-xs text-[var(--text-secondary)] w-24">{plan.planDate}</span>
            <span className="text-sm font-semibold text-[var(--text-primary)] flex-1 min-w-0 truncate">{plan.userName}</span>
            <span className="tabular-nums text-sm text-[var(--text-primary)]">{plan.startTime} – {plan.endTime}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Plan personeli" className={fieldClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">Personel seçin</option>
          {staff.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <Input aria-label="Plan tarihi" type="date" className="min-h-12 !w-40" value={date} onChange={(event) => setDate(event.target.value)} />
        <Input aria-label="Başlangıç" type="time" className="min-h-12 !w-28" value={start} onChange={(event) => setStart(event.target.value)} />
        <Input aria-label="Bitiş saati" type="time" className="min-h-12 !w-28" value={end} onChange={(event) => setEnd(event.target.value)} />
        <Button variant="primary" className="min-h-12 text-xs font-bold" disabled={userId === ''} onClick={() => void save()}>
          Plana Ekle
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
