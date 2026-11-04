import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText, localDate } from '../../../lib/cariInput';
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

/** Ücretli izin bordrodan kesilmez; yalnız ücretsiz izin taban/30 × gün keser. */
const PAID_KINDS: Record<string, string> = { YILLIK: 'Yıllık', HASTALIK: 'Hastalık', MAZERET: 'Mazeret' };
const UNPAID = 'UCRETSIZ';
const kindLabel = (kind: string) => (kind === UNPAID ? 'Ücretsiz izin' : `${PAID_KINDS[kind] ?? kind} · Ücretli`);
const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

const tone = (status: string) =>
  status === 'Onaylandi' ? 'text-[var(--accent-emerald)]' : status === 'Bekliyor' ? 'text-[var(--accent-amber)]' : 'text-[var(--text-muted)]';

const statusLabel = (status: string) =>
  ({ Bekliyor: 'Bekliyor', Onaylandi: 'Onaylandı', Reddedildi: 'Reddedildi' })[status] ?? status;

type LeavePanelProps =
  | { userId: string; staff?: never }
  | { userId?: never; staff: { id: string; name: string }[] };

export const LeavePanel: React.FC<LeavePanelProps> = ({ userId, staff }) => {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [kind, setKind] = useState('YILLIK');
  const [start, setStart] = useState(() => localDate(new Date()));
  const [end, setEnd] = useState(() => localDate(new Date()));
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
    const today = localDate(new Date());
    setStart(today);
    setEnd(today);
  };

  const visible = userId
    ? [...leaves].sort((a, b) => Number(b.status === 'Bekliyor') - Number(a.status === 'Bekliyor')).slice(0, 12)
    : leaves.filter((row) => row.status === 'Bekliyor');
  const names = new Map(staff?.map((member) => [member.id, member.name]));
  const { actorId, actorRole, tenantId } = sessionArgs();

  return (
    <Panel
      title={userId ? 'İzinler' : 'Bekleyen İzin Talepleri'}
    >
      {visible.length === 0 && !error ? <p className="text-sm text-[var(--text-secondary)]">{userId ? 'İzin kaydı yok.' : 'Bekleyen izin talebi yok.'}</p> : null}
      <ul className="flex flex-col gap-1">
        {visible.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 min-h-12 border-b border-[var(--border)] last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-semibold truncate ${row.kind === UNPAID ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'}`}>{!userId ? `${names.get(row.userId) ?? 'Personel'} · ` : ''}{kindLabel(row.kind)}</span>
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
            {userId ? <>
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
            </> : null}
          </li>
        ))}
      </ul>
      {userId ? <div className="flex flex-wrap gap-2 mt-auto">
        <Button variant={kind !== UNPAID ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setKind('YILLIK')}>
          Ücretli
        </Button>
        <Button variant={kind === UNPAID ? 'selected' : 'secondary'} className="min-h-12 text-sm" onClick={() => setKind(UNPAID)}>
          Ücretsiz
        </Button>
        {kind !== UNPAID ? (
          <select aria-label="Ücretli izin türü" className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
            {Object.entries(PAID_KINDS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        ) : null}
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
      </div> : null}
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
