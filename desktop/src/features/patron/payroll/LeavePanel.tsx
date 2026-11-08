import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, localDate } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';
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
  const [selected, setSelected] = useState<LeaveRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setKind('YILLIK');
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
      aside={userId ? <Button type="button" variant="primary" onClick={() => {
        resetForm();
        setError(null);
        setFormOpen(true);
      }}>İzin Ekle</Button> : undefined}
    >
      {visible.length === 0 && !error ? <p className="text-sm text-[var(--text-secondary)]">{userId ? 'İzin kaydı yok.' : 'Bekleyen izin talebi yok.'}</p> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {visible.map((row) => (
          <li key={row.id}>
            <RecordCard title={userId ? kindLabel(row.kind) : `${names.get(row.userId) ?? 'Personel'} · ${kindLabel(row.kind)}`}
              description={`${formatDay(row.startDate)} → ${formatDay(row.endDate)} · ${statusLabel(row.status)}`}
              onOpen={() => { setError(null); setSelected(row); }} />
          </li>
        ))}
      </ul>

      {selected ? (
        <Modal cardFlow isOpen title={kindLabel(selected.kind)}
          subtitle={`${formatDay(selected.startDate)} → ${formatDay(selected.endDate)}`} maxWidth="sm"
          onClose={() => { if (!inFlight.current) setSelected(null); }}>
          <div className="space-y-4">
            {!userId ? <p className="text-sm font-bold">{names.get(selected.userId) ?? 'Personel'}</p> : null}
            <p className="text-sm">{statusLabel(selected.status)}</p>
            {selected.reason ? <p className="break-words text-sm">{selected.reason}</p> : null}
            {error ? <ErrorToast message={error} /> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {userId ? (
                <>
                  <Button type="button" disabled={busy} onClick={() => {
                    setEditing(selected);
                    setKind(selected.kind);
                    setStart(selected.startDate);
                    setEnd(selected.endDate);
                    setError(null);
                    setSelected(null);
                    setFormOpen(true);
                  }}>Düzenle</Button>
                  <Button type="button" variant="danger" disabled={busy}
                    onClick={() => { setDeleting(selected); setSelected(null); }}>Sil</Button>
                </>
              ) : null}
              {selected.status === 'Bekliyor' ? [false, true].map((approve) => (
                <Button key={String(approve)} type="button" variant={approve ? 'primary' : 'secondary'} disabled={busy}
                  onClick={() => void run(async () => {
                    await invokeIPC('decide_leave', { tenantId, approverId: actorId, actorRole, leaveId: selected.id, approve });
                    setSelected(null);
                  })}>{approve ? 'Onayla' : 'Reddet'}</Button>
              )) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {userId && formOpen ? (
        <Modal cardFlow isOpen title={editing ? 'İzni Düzenle' : 'İzin Ekle'} maxWidth="sm"
          onClose={() => { if (!inFlight.current) { setFormOpen(false); setError(null); } }}>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            if (!start || !end) return;
            void run(async () => {
              const input = { userId, kind, startDate: start, endDate: end, reason: editing?.reason ?? null };
              if (editing) await invokeIPC('update_leave', { tenantId, actorRole, leaveId: editing.id, input });
              else await invokeIPC('request_leave', { tenantId, actorId, actorRole, input });
              setFormOpen(false);
            });
          }}>
            <fieldset disabled={busy} className="space-y-3">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="İzin türü">
                <Button type="button" aria-pressed={kind !== UNPAID} variant={kind !== UNPAID ? 'selected' : 'secondary'} onClick={() => setKind('YILLIK')}>Ücretli</Button>
                <Button type="button" aria-pressed={kind === UNPAID} variant={kind === UNPAID ? 'selected' : 'secondary'} onClick={() => setKind(UNPAID)}>Ücretsiz</Button>
              </div>
              {kind !== UNPAID ? (
                <label className="grid gap-1 text-sm">
                  Ücretli İzin Türü
                  <select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
                    {Object.entries(PAID_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-sm">Başlangıç
                  <Input required type="date" value={start} onChange={(event) => {
                    const next = event.target.value;
                    setStart(next);
                    if (next && next > end) setEnd(next);
                  }} />
                </label>
                <label className="grid gap-1 text-sm">Bitiş
                  <Input required type="date" min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} />
                </label>
              </div>
            </fieldset>
            {error ? <ErrorToast message={error} /> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => { setFormOpen(false); setError(null); }}>Vazgeç</Button>
              <Button type="submit" variant="primary" isLoading={busy} disabled={!start || !end}>Kaydet</Button>
            </div>
          </form>
        </Modal>
      ) : null}
      {error && !selected && !formOpen ? <ErrorToast message={error} /> : null}
      {deleting ? (
        <ConfirmDialog cardFlow
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
