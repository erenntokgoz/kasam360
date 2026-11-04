import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
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
  const [deleting, setDeleting] = useState<BackupFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

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
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const { actorId, actorRole, tenantId } = sessionArgs();

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

      <Button variant="primary" className="w-full min-h-12" isLoading={isBusy} onClick={() => void run(() => invokeIPC('create_backup_now', { actorRole }))}>
        Şimdi Yedekle
      </Button>

      <label className="block text-xs font-semibold text-[var(--text-secondary)]">
        İkinci yedek klasörü (harici disk önerilir)
        <div className="flex gap-2 mt-1">
          <Input id="backup-mirror" className="min-h-12" value={mirror} onChange={(event) => setMirror(event.target.value)} />
          <Button
            variant="secondary"
            className="min-h-12 shrink-0"
            onClick={() => void run(() => invokeIPC('set_backup_mirror', { mirrorDir: mirror, actorRole }))}
          >
            Kaydet
          </Button>
        </div>
      </label>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--border)]">
        {files.slice(0, 20).map((file) => (
          <li key={file.path} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">{stampText(file.createdAt)}</p>
              <p className="text-sm text-[var(--text-secondary)] tabular-nums">
                {TAG_LABEL[file.tag] ?? file.tag} · {formatNumber(Math.ceil(file.bytes / 1024))} KB
              </p>
            </div>
            <Button variant="secondary" className="shrink-0" onClick={() => setTarget(file)}>
              Geri Dön
            </Button>
            <Button variant="ghost" className="shrink-0" aria-label={`${stampText(file.createdAt)} yedeğini sil`} onClick={() => setDeleting(file)}>
              <Trash2 className="w-5 h-5" />
            </Button>
          </li>
        ))}
      </ul>

      {deleting ? (
        <ConfirmDialog
          title="Yedek silinsin mi?"
          message={stampText(deleting.createdAt)}
          onConfirm={async () => {
            await invokeIPC('delete_backup', { filePath: deleting.path, actorRole });
            await load();
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {target ? (
        <Modal
          isOpen
          onClose={() => {
            setTarget(null);
            setPin('');
          }}
          title="Yedeğe Geri Dön"
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              {stampText(target.createdAt)} sonrasındaki işlemler ekrandan kalkar. Mevcut veri önce ayrıca yedeklenir. Uygulama yeniden açılır.
            </p>
            <NumberInput
              id="restore-pin"
              aria-label="PIN"
              kind="digits"
              type="password"
              placeholder="PIN"
              maxLength={8}
              value={pin}
              onValueChange={setPin}
            />
            {error ? (
              <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
                {error}
              </p>
            ) : null}
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              disabled={pin.length < 4}
              isLoading={isBusy}
              onClick={() => void run(() => invokeIPC('restore_backup', { filePath: target.path, pin, actorId, actorRole, tenantId }))}
            >
              Geri Dön ve Yeniden Aç
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
};
