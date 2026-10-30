import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useSetupStore } from '../../stores/setupStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

export const JoinBusinessForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { draft, saveProgress, joinExisting } = useSetupStore();
  const [deviceName, setDeviceName] = useState(draft.deviceName);
  // Kod gizlidir: taslağa yazılmaz, yarım kalan katılım yeni kod ister.
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const join = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await saveProgress('JOIN', { ...draft, deviceName });
      await joinExisting(code.trim(), deviceName.trim());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--text-secondary)]">
        İşletme sahibi mevcut cihazda Cihazlar ekranından eşleştirme kodu üretir. Kod tek
        kullanımlıktır, 10 dakika geçerlidir.
      </p>
      {error ? (
        <div role="alert" className="p-3 rounded-lg text-xs font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div>
        <label htmlFor="setup-device-name" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          Cihaz Adı *
        </label>
        <Input
          id="setup-device-name"
          className="min-h-12"
          value={deviceName}
          maxLength={60}
          onChange={(event) => setDeviceName(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="setup-join-code" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          Eşleştirme Kodu *
        </label>
        <Input
          id="setup-join-code"
          className="min-h-12 font-mono"
          autoComplete="off"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={onBack}>
          Geri
        </Button>
        <Button
          type="button"
          variant="primary"
          className="min-h-12"
          disabled={!deviceName.trim() || !code.trim()}
          isLoading={isBusy}
          onClick={() => void join()}
        >
          Cihazı Bağla
        </Button>
      </div>
    </div>
  );
};
