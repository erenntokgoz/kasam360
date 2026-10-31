import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

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
  const [password, setPassword] = useState('');
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

  const { actorRole } = sessionArgs();

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-5 space-y-3">
      <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Yedekler</h2>
      <p className="text-xs text-[var(--text-secondary)]">
        Değişiklik varsa saatte bir ve her gün sonunda yedek alınır. Son yedek:{' '}
        <span className="font-semibold tabular-nums">{status?.lastBackupAt ?? 'Henüz yok'}</span>
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
          <li key={file.path} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">{stampText(file.createdAt)}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {TAG_LABEL[file.tag] ?? file.tag} · {Math.ceil(file.bytes / 1024)} KB
              </p>
            </div>
            <Button variant="secondary" className="min-h-12 shrink-0" onClick={() => setTarget(file)}>
              Geri Dön
            </Button>
          </li>
        ))}
      </ul>

      {target ? (
        <Modal isOpen onClose={() => setTarget(null)} title="Yedeğe Geri Dön" maxWidth="sm">
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {stampText(target.createdAt)} sonrasındaki işlemler ekrandan kalkar. Mevcut veri önce ayrıca yedeklenir. Uygulama yeniden açılır.
            </p>
            <Input
              id="restore-password"
              aria-label="Hesap şifresi"
              type="password"
              placeholder="Hesap şifresi"
              className="min-h-12"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error ? (
              <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
                {error}
              </p>
            ) : null}
            <Button
              variant="danger"
              className="w-full min-h-12"
              disabled={password.length === 0}
              isLoading={isBusy}
              onClick={() => void run(() => invokeIPC('restore_backup', { filePath: target.path, password, actorRole }))}
            >
              Geri Dön ve Yeniden Aç
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
};
