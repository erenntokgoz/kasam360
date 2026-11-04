import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
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

const KINDS: Record<string, string> = { YILLIK: 'Yıllık', HASTALIK: 'Hastalık', MAZERET: 'Mazeret', UCRETSIZ: 'Ücretsiz' };
const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

const tone = (status: string) =>
  status === 'Onaylandi' ? 'text-[var(--accent-emerald)]' : status === 'Bekliyor' ? 'text-[var(--accent-amber)]' : 'text-[var(--text-muted)]';

const statusLabel = (status: string) =>
  ({ Bekliyor: 'Bekliyor', Onaylandi: 'Onaylandı', Reddedildi: 'Reddedildi' })[status] ?? status;

export const LeavePanel: React.FC<{ userId: string }> = ({ userId }) => {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [kind, setKind] = useState('YILLIK');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [editing, setEditing] = useState<LeaveRow | null>(null);
  const [deleting, setDeleting] = useState<LeaveRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      setLeaves(await invokeIPC<LeaveRow[]>('list_leave_requests', { tenantId, actorRole, userId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [userId]);

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

  const resetForm = () => {
    setEditing(null);
    setStart('');
    setEnd('');
  };

  const ordered = [...leaves].sort((a, b) => Number(b.status === 'Bekliyor') - Number(a.status === 'Bekliyor'));
  const { actorId, actorRole, tenantId } = sessionArgs();

  return (
    <Panel
      title="İzinler"
    >
      {ordered.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">İzin kaydı yok.</p> : null}
      <ul className="flex flex-col gap-1">
        {ordered.slice(0, 12).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 min-h-12 border-b border-[var(--border)] last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{KINDS[row.kind] ?? row.kind}</span>
              <span className="block text-xs tabular-nums text-[var(--text-secondary)]">{formatDay(row.startDate)} → {formatDay(row.endDate)}</span>
            </span>
            <span className={`text-xs font-bold ${tone(row.status)}`}>{statusLabel(row.status)}</span>
            {row.status === 'Bekliyor' ? (
              <>
                <Button variant="primary" className="min-h-12 text-sm" onClick={() => void run(() => invokeIPC('decide_leave', { tenantId, approverId: actorId, actorRole, leaveId: row.id, approve: true }))}>
                  Onayla
                </Button>
                <Button variant="secondary" className="min-h-12 text-sm" onClick={() => void run(() => invokeIPC('decide_leave', { tenantId, approverId: actorId, actorRole, leaveId: row.id, approve: false }))}>
                  Reddet
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              aria-label="İzni düzenle"
              onClick={() => {
                setEditing(row);
                setKind(row.kind);
                setStart(row.startDate);
                setEnd(row.endDate);
              }}
            >
              <Pencil className="w-5 h-5" />
            </Button>
            <Button variant="ghost" aria-label="İzni sil" onClick={() => setDeleting(row)}>
              <Trash2 className="w-5 h-5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 mt-auto">
        <select aria-label="İzin türü" className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
          {Object.entries(KINDS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <Input aria-label="Başlangıç" type="date" className="min-h-12 !w-40" value={start} onChange={(event) => setStart(event.target.value)} />
        <Input aria-label="Bitiş" type="date" className="min-h-12 !w-40" value={end} onChange={(event) => setEnd(event.target.value)} />
        <Button
          variant="secondary"
          className="min-h-12 text-sm font-bold"
          disabled={!start || !end}
          onClick={() => void run(async () => {
            const input = { userId, kind, startDate: start, endDate: end, reason: editing?.reason ?? null };
            if (editing) await invokeIPC('update_leave', { tenantId, actorRole, leaveId: editing.id, input });
            else await invokeIPC('request_leave', { tenantId, actorId, actorRole, input });
            resetForm();
          })}
        >
          {editing ? 'Kaydet' : 'İzin Ekle'}
        </Button>
        {editing ? (
          <Button variant="ghost" className="min-h-12 text-sm" onClick={resetForm}>
            Vazgeç
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      {deleting ? (
        <ConfirmDialog
          title="İzin silinsin mi?"
          message={`${formatDay(deleting.startDate)} → ${formatDay(deleting.endDate)}`}
          onConfirm={async () => {
            await invokeIPC('delete_leave', { tenantId, actorRole, leaveId: deleting.id });
            await load();
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Panel>
  );
};
