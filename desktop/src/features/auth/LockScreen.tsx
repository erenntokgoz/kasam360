import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { Numpad } from '../../ui/Numpad';
import { AuthLayout } from './AuthLayout';

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
    <div role="dialog" aria-modal="true" aria-label="Ekran kilitli">
      <AuthLayout title="Ekran kilitli." subtitle={`${user.name} oturumu açık kaldı.`} zIndexClass="z-[60]">
        {loginError ? (
          <div role="alert" className="p-3 rounded-md text-sm font-semibold border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loginError}</span>
          </div>
        ) : null}
        <div className="flex justify-center gap-4 h-8 items-center" aria-label={`${pin.length} hane girildi`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, idx) => (
            <span
              key={idx}
              className={`w-5 h-5 rounded-full border-2 border-[var(--print)] ${pin.length > idx ? 'bg-[var(--print)]' : ''}`}
            />
          ))}
        </div>
        <Numpad
          onDigit={(digit) => {
            if (pin.length < 8) setPin((current) => current + digit);
          }}
          onClear={() => setPin('')}
          onBackspace={() => setPin((current) => current.slice(0, -1))}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" size="lg" onClick={logout}>
            Kullanıcı Değiştir
          </Button>
          <Button type="button" variant="primary" size="lg" disabled={pin.length < 4} isLoading={isBusy} onClick={() => void submit()}>
            Kilidi Aç
          </Button>
        </div>
      </AuthLayout>
    </div>
  );
};
