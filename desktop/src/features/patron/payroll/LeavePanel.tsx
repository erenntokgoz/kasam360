import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';

interface LeaveRow {
  id: string;
  userId: string;
  kind: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
}

interface StaffRow {
  id: string;
  name: string;
}

const KINDS: Record<string, string> = { YILLIK: 'Yıllık', HASTALIK: 'Hastalık', MAZERET: 'Mazeret', UCRETSIZ: 'Ücretsiz' };
const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

const tone = (status: string) =>
  status === 'Onaylandi' ? 'text-[var(--accent-emerald)]' : status === 'Bekliyor' ? 'text-[var(--accent-amber)]' : 'text-[var(--text-muted)]';

const statusLabel = (status: string) =>
  ({ Bekliyor: 'Bekliyor', Onaylandi: 'Onaylandı', Reddedildi: 'Reddedildi' })[status] ?? status;

const isoDay = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const LeavePanel: React.FC = () => {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState('YILLIK');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [rows, people] = await Promise.all([
        invokeIPC<LeaveRow[]>('list_leave_requests', { tenantId, actorRole }),
        invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId, includeInactive: false }),
      ]);
      setLeaves(rows);
      setStaff(people);
      setUserId((current) => current || people[0]?.id || '');
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

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

  const name = (id: string) => staff.find((row) => row.id === id)?.name ?? id;
  const today = isoDay(new Date());
  const away = leaves.filter((row) => row.status === 'Onaylandi' && row.startDate <= today && row.endDate >= today);
  const ordered = [...leaves].sort((a, b) => Number(b.status === 'Bekliyor') - Number(a.status === 'Bekliyor'));
  const { actorId, actorRole, tenantId } = sessionArgs();

  return (
    <Panel
      title="İzinler"
      aside={<span className="text-xs text-[var(--text-secondary)]">{away.length > 0 ? `Bugün izinli: ${away.map((row) => name(row.userId)).join(', ')}` : 'Bugün izinli yok'}</span>}
    >
      {ordered.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">İzin kaydı yok.</p> : null}
      <ul className="flex flex-col gap-1">
        {ordered.slice(0, 12).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 min-h-12 border-b border-[var(--border)] last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{name(row.userId)} · {KINDS[row.kind] ?? row.kind}</span>
              <span className="block text-xs tabular-nums text-[var(--text-secondary)]">{row.startDate} → {row.endDate}</span>
            </span>
            <span className={`text-xs font-bold ${tone(row.status)}`}>{statusLabel(row.status)}</span>
            {row.status === 'Bekliyor' ? (
              <>
                <Button variant="primary" className="min-h-12 text-xs" onClick={() => void run(() => invokeIPC('decide_leave', { tenantId, approverId: actorId, actorRole, leaveId: row.id, approve: true }))}>
                  Onayla
                </Button>
                <Button variant="secondary" className="min-h-12 text-xs" onClick={() => void run(() => invokeIPC('decide_leave', { tenantId, approverId: actorId, actorRole, leaveId: row.id, approve: false }))}>
                  Reddet
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 mt-auto">
        <select aria-label="İzinli personel" className={fieldClass} value={userId} onChange={(event) => setUserId(event.target.value)}>
          {staff.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
        <select aria-label="İzin türü" className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
          {Object.entries(KINDS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <Input aria-label="Başlangıç" type="date" className="min-h-12 !w-40" value={start} onChange={(event) => setStart(event.target.value)} />
        <Input aria-label="Bitiş" type="date" className="min-h-12 !w-40" value={end} onChange={(event) => setEnd(event.target.value)} />
        <Button
          variant="secondary"
          className="min-h-12 text-xs font-bold"
          disabled={!userId || !start || !end}
          onClick={() => void run(async () => {
            await invokeIPC('request_leave', { tenantId, actorRole, input: { userId, kind, startDate: start, endDate: end, reason: null } });
            setStart('');
            setEnd('');
          })}
        >
          İzin Ekle
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
