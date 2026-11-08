import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatNumber } from '../../lib/numberText';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { RecordCard } from './RecordCard';

interface BackupStatus {
  directory: string;
  mirrorDir: string | null;
  lastBackupAt: string | null;
  lastError: string | null;
  lastRestoredAt: string | null;
  restoredFrom: string | null;
}

interface BackupFile {
  name: string;
  path: string;
  tag: string;
  bytes: number;
  createdAt: string;
}

const TAG_LABEL: Record<string, string> = {
  otomatik: 'Otomatik',
  elle: 'Elle',
  gunsonu: 'Gün sonu',
  geri_donus_oncesi: 'Geri dönüş öncesi',
};

/** `20261030T174501123Z` biçimindeki yedek zamanını yerel saatle gösterir. */
function stampText(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toLocaleString('tr-TR');
}

/** Yedek durumu, ikinci klasör ve geri dönüş. Hata sessiz kalmaz, burada görünür. */
export const BackupPanel: React.FC = () => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [mirror, setMirror] = useState('');
  const [target, setTarget] = useState<BackupFile | null>(null);
  const [pin, setPin] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const { actorRole } = sessionArgs();
      const [nextStatus, nextFiles] = await Promise.all([
        invokeIPC<BackupStatus>('get_backup_status', { actorRole }),
        invokeIPC<BackupFile[]>('list_backups', { actorRole }),
      ]);
      setStatus(nextStatus);
      setFiles(nextFiles);
      setMirror(nextStatus.mirrorDir ?? '');
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      inFlight.current = false;
      setIsBusy(false);
    }
  };

  const { actorId, actorRole, tenantId } = sessionArgs();
  const closeDetail = () => {
    if (inFlight.current) return;
    setTarget(null);
    setRestoring(false);
    setPin('');
    setError(null);
  };

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-4">
      <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Yedekler</h2>
      <p className="text-xs text-[var(--text-secondary)]">
        Son yedek:{' '}
        <span className="font-semibold tabular-nums">{status?.lastBackupAt ? formatDateTime(status.lastBackupAt) : 'Henüz yok'}</span>
      </p>
      <p className="text-xs text-[var(--text-secondary)] break-all">Klasör: {status?.directory ?? 'Okunamadı'}</p>
      {status?.lastError ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          Son yedek hatası: {status.lastError}
        </p>
      ) : null}
      {status?.lastRestoredAt ? (
        <p className="text-xs text-[var(--text-secondary)] break-all">
          Son geri dönüş: {status.lastRestoredAt} · {status.restoredFrom}
        </p>
      ) : null}

      <Button variant="primary" className="min-h-12" isLoading={isBusy} onClick={() => void run(() => invokeIPC('create_backup_now', { actorRole }))}>
        Şimdi Yedekle
      </Button>

      <label className="block text-xs font-semibold text-[var(--text-secondary)]">
        İkinci yedek klasörü (harici disk önerilir)
        <div className="flex gap-2 mt-1">
          <Input id="backup-mirror" className="min-h-12" value={mirror} onChange={(event) => setMirror(event.target.value)} />
          <Button
            variant="secondary"
            className="min-h-12 shrink-0"
            disabled={isBusy}
            onClick={() => void run(() => invokeIPC('set_backup_mirror', { mirrorDir: mirror, actorRole }))}
          >
            Kaydet
          </Button>
        </div>
      </label>

      {error && !restoring ? (
        <ErrorToast message={error} />
      ) : null}

      {files.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Henüz yedek yok.</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {files.slice(0, 20).map((file) => (
          <li key={file.path}>
            <RecordCard title={stampText(file.createdAt)}
              description={`${TAG_LABEL[file.tag] ?? file.tag} · ${formatNumber(Math.ceil(file.bytes / 1024))} KB`}
              onOpen={() => { setError(null); setTarget(file); }} />
          </li>
        ))}
      </ul>

      {deleting && target ? (
        <ConfirmDialog cardFlow
          title="Yedek silinsin mi?"
          message={stampText(target.createdAt)}
          onConfirm={async () => {
            await invokeIPC('delete_backup', { filePath: target.path, actorRole });
            closeDetail();
            await load();
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}

      {target && !deleting ? (
        <Modal cardFlow isOpen onClose={closeDetail} title={restoring ? 'Yedeğe Geri Dön' : 'Yedek Ayrıntısı'}
          subtitle={stampText(target.createdAt)} maxWidth="sm">
          {restoring ? (
            <form className="space-y-4" onSubmit={(event) => {
              event.preventDefault();
              if (pin.length >= 4) void run(() => invokeIPC('restore_backup', { filePath: target.path, pin, actorId, actorRole, tenantId }));
            }}>
              <p className="text-sm text-[var(--text-secondary)]">
                Bu yedekten sonraki işlemler ekrandan kalkar. Mevcut veri önce ayrıca yedeklenir. Uygulama yeniden açılır.
              </p>
              <label className="block space-y-1 text-sm font-semibold">
                <span>PIN</span>
                <NumberInput kind="digits" type="password" maxLength={8} value={pin} onValueChange={setPin} disabled={isBusy} />
              </label>
              {error ? <ErrorToast message={error} /> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" disabled={isBusy} onClick={() => { setRestoring(false); setPin(''); setError(null); }}>Vazgeç</Button>
                <Button type="submit" variant="danger" disabled={pin.length < 4} isLoading={isBusy}>Geri Dön ve Yeniden Aç</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm">
                <div><dt className="font-semibold">Dosya</dt><dd className="break-all">{target.name}</dd></div>
                <div><dt className="font-semibold">Tür</dt><dd>{TAG_LABEL[target.tag] ?? target.tag}</dd></div>
                <div><dt className="font-semibold">Boyut</dt><dd className="tabular-nums">{formatNumber(Math.ceil(target.bytes / 1024))} KB</dd></div>
              </dl>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={isBusy} onClick={() => setDeleting(true)}>Yedeği Sil</Button>
                <Button variant="primary" disabled={isBusy} onClick={() => setRestoring(true)}>Geri Dön</Button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}
    </section>
  );
};
