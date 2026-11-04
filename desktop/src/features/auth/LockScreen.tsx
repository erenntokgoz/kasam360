import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AuthShell } from './AuthShell';
import { PinEntry } from './PinEntry';

/** Kilit kimin PIN'i girilirse ona açılır: kasa başına geçen kişi çıkış yapmaz. */
export const LockScreen: React.FC = () => {
  const { user, isLocked, loginWithPin, loginError } = useAuthStore();
  const resetIdleTimer = useUIStore((state) => state.resetIdleTimer);
  const [pin, setPin] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  if (!isLocked || !user) return null;

  const submit = async () => {
    if (pin.length < 4 || isBusy) return;
    setIsBusy(true);
    const opened = await loginWithPin(pin);
    setIsBusy(false);
    setPin('');
    if (opened) resetIdleTimer();
  };

  return (
    <AuthShell title="Ekran kilitli">
      {loginError ? (
        <div role="alert" className="p-3 rounded-lg text-sm font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loginError}</span>
        </div>
      ) : null}
      <PinEntry value={pin} onChange={setPin} onSubmit={() => void submit()} isBusy={isBusy} />
    </AuthShell>
  );
};
