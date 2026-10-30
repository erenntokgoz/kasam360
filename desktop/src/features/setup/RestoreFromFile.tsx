import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

/** Bozulan cihazın yerine geçen yeni kurulum, harici diskteki yedekten açılır. */
export const RestoreFromFile: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [filePath, setFilePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const restore = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await invokeIPC('restore_backup_on_setup', { filePath: filePath.trim() });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  if (!isOpen) {
    return (
      <Button type="button" variant="ghost" className="w-full min-h-12" onClick={() => setIsOpen(true)}>
        Yedekten Geri Dön
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-[var(--text-secondary)]">
        Yedek dosyasının yolu (.db, yanında .sha256 dosyasıyla)
        <Input id="restore-path" className="min-h-12 mt-1" value={filePath} onChange={(event) => setFilePath(event.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)] break-all">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="primary" className="w-full min-h-12" disabled={!filePath.trim()} isLoading={isBusy} onClick={() => void restore()}>
        Yedeği Yükle
      </Button>
    </div>
  );
};
