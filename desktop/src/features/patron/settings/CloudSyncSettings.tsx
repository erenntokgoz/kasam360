import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDateTime } from '../../../lib/date';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';
import { InlineAlert } from '../../../ui/InlineAlert';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';

interface CloudSyncStatus {
  state: 'DISABLED' | 'IDLE' | 'SYNCING' | 'OFFLINE' | 'HALTED' | 'ERROR';
  pending: number;
  reviews: CloudSyncReview[];
  lastPushAt: string | null;
  lastPullAt: string | null;
  errorCode: string | null;
  error: string | null;
  wipePending: boolean;
}

interface CloudSyncReview {
  operationId: string;
  decision: 'PENDING' | 'REJECTED';
  reason: string;
  deviceId: string;
  kind: string;
  targetId: string;
  createdAt: string;
}

interface SyncConflict {
  id: string;
  kind: string;
  deviceId: string;
  targetTable: string;
  targetId: string;
  createdAt: string;
}

const STATE_LABEL: Record<CloudSyncStatus['state'], string> = {
  DISABLED: 'Bulut bağlı değil',
  IDLE: 'Bulutla eşit',
  SYNCING: 'Gönderiliyor',
  OFFLINE: 'İnternet yok, kasa çalışıyor',
  HALTED: 'Lisans reddedildi',
  ERROR: 'Eşitleme durdu',
};

const CONFLICT_LABEL: Record<string, string> = {
  ORDER_CONFLICT: 'Adisyon iki cihazda kapandı',
};

function statusLine(status: CloudSyncStatus): string {
  const parts = [STATE_LABEL[status.state]];
  if (status.pending > 0) parts.push(`${status.pending} işlem bekliyor`);
  if (status.lastPushAt) parts.push(`son gönderim ${formatDateTime(status.lastPushAt)}`);
  return parts.join(' · ');
}

/** Bulut durumu ve ağ bölünmesinden kalan çakışmalar. Çakışma notla kapanır, satıra dokunmaz. */
export function CloudSyncSettings({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [open, setOpen] = useState<SyncConflict | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await invokeIPC<CloudSyncStatus>('get_cloud_sync_status'));
      if (canManage) {
        const { actorRole, tenantId } = sessionArgs();
        setConflicts(await invokeIPC<SyncConflict[]>('list_sync_conflicts', { actorRole, tenantId, pendingOnly: true }));
      }
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [canManage]);

  useEffect(() => {
    void load();
    const stop = listen<CloudSyncStatus>('cloud-sync-status', (event) => setStatus(event.payload));
    return () => { void stop.then((unlisten) => unlisten()); };
  }, [load]);

  const resolve = async () => {
    if (!open || !note.trim()) return;
    setBusy(true);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('resolve_sync_conflict', { actorId, actorRole, tenantId, conflictId: open.id, note: note.trim() });
      setOpen(null);
      setNote('');
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="work-surface rounded-lg border border-[var(--border)] p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Bulut</h2>
          <p className="text-sm text-[var(--text-secondary)] tabular-nums">{status ? statusLine(status) : 'Durum alınamadı'}</p>
        </div>
        <Button onClick={() => void load()}>Yenile</Button>
      </header>
      {status?.error && status.state !== 'IDLE' ? <InlineAlert message={status.error} /> : null}
      {status?.reviews.length ? (
        <section aria-labelledby="cloud-review-title" className="rounded-md border border-[var(--border)] p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="cloud-review-title" className="font-semibold">Bulut incelemesi</h3>
              <p className="text-sm text-[var(--text-secondary)]">Yerel kayıtlar korunur. İşletme OWNER'ı web Hesabım sayfasında karar verir.</p>
            </div>
            <Button onClick={() => void invokeIPC('retry_cloud_sync').then(load).catch((caught: unknown) => setError(errorText(caught)))}>
              Eşitlemeyi yeniden dene
            </Button>
          </div>
          <ul className="space-y-2">
            {status.reviews.map((review) => (
              <li key={review.operationId} className="rounded-md bg-[var(--surface-raised)] p-3">
                <p className="font-medium">{review.decision === 'PENDING' ? 'OWNER kararı bekleniyor' : 'İşletme sahibi reddetti'}</p>
                <p className="text-sm text-[var(--text-secondary)]">Cihaz {review.deviceId} · {review.kind} · {review.targetId}</p>
                <p className="text-sm text-[var(--text-secondary)]">Kasa zamanı {formatDateTime(review.createdAt)}</p>
                <p className="text-sm">{review.reason}</p>
                {review.decision === 'REJECTED' && <p className="text-sm font-medium">İşlem bu kasada ve yerel ürün verisinde saklı; buluta tekrar gönderilmeyecek.</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {error && !open ? <ErrorToast message={error} /> : null}
      {conflicts.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {conflicts.map((conflict) => (
            <li key={conflict.id}>
              <RecordCard title={CONFLICT_LABEL[conflict.kind] ?? conflict.kind}
                description={`${conflict.targetId} · ${formatDateTime(conflict.createdAt)}`}
                onOpen={() => { setNote(''); setError(null); setOpen(conflict); }} />
            </li>
          ))}
        </ul>
      ) : null}
      <Modal cardFlow isOpen={open !== null} title={open ? CONFLICT_LABEL[open.kind] ?? open.kind : ''} maxWidth="sm"
        onClose={() => { if (!busy) setOpen(null); }}>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
          <label className="block space-y-1"><span className="text-sm font-semibold">Not</span>
            <Input aria-label="Çakışma notu" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} required />
          </label>
          {error ? <ErrorToast message={error} /> : null}
          <Button type="submit" variant="primary" isLoading={busy} disabled={!note.trim()}>Kapat</Button>
        </form>
      </Modal>
    </section>
  );
}
