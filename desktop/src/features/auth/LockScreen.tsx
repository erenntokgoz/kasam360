import React, { useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { Numpad } from '../../ui/Numpad';

export const LockScreen: React.FC = () => {
  const { user, isLocked, unlock, logout, loginError } = useAuthStore();
  const resetIdleTimer = useUIStore((state) => state.resetIdleTimer);
  const [pin, setPin] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  if (!isLocked || !user) return null;

  const submit = async () => {
    if (pin.length < 4 || isBusy) return;
    setIsBusy(true);
    const opened = await unlock(pin);
    setIsBusy(false);
    setPin('');
    if (opened) resetIdleTimer();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Terminal kilitli"
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-6 bg-[var(--bg-canvas)] select-none"
    >
      <div className="w-full max-w-[360px] bg-[var(--bg-panel)] border border-[var(--border)] rounded-2xl p-6 flex flex-col gap-5">
        <div className="text-center">
          <Lock className="w-6 h-6 mx-auto text-[var(--text-secondary)]" />
          <h1 className="text-base font-bold mt-2 text-[var(--text-primary)]">Terminal Kilitli</h1>
          <p className="text-xs mt-1 text-[var(--text-secondary)]">
            {user.name} oturumu. Devam etmek için PIN kodunuzu girin.
          </p>
        </div>
        {loginError ? (
          <div role="alert" className="p-3 rounded-lg text-xs font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loginError}</span>
          </div>
        ) : null}
        <div aria-label="Girilen hane sayısı" className="h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center text-xl font-bold tracking-[0.4em] text-[var(--text-primary)]">
          {'•'.repeat(pin.length)}
        </div>
        <Numpad
          onDigit={(digit) => {
            if (pin.length < 8) setPin((current) => current + digit);
          }}
          onClear={() => setPin('')}
          onBackspace={() => setPin((current) => current.slice(0, -1))}
        />
        <Button type="button" variant="primary" size="lg" className="w-full" disabled={pin.length < 4} isLoading={isBusy} onClick={() => void submit()}>
          Kilidi Aç
        </Button>
        <Button type="button" variant="secondary" className="w-full min-h-12" onClick={logout}>
          Kullanıcı Değiştir
        </Button>
      </div>
    </div>
  );
};
