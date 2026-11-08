import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AuthShell } from './AuthShell';
import { PinEntry } from './PinEntry';

export const LoginOverlay: React.FC = () => {
  const { isAuthenticated, loginWithPin, loginError } = useAuthStore();
  const resetIdleTimer = useUIStore((state) => state.resetIdleTimer);
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  if (isAuthenticated) return null;

  const submit = async () => {
    if (pin.length < 4 || isSubmitting) return;
    setIsSubmitting(true);
    const success = await loginWithPin(pin);
    setIsSubmitting(false);
    setPin('');
    if (success) {
      resetIdleTimer();
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <AuthShell title="PIN kodunu gir" dialogLabel="Personel girişi" className={shake ? 'animate-shake' : ''}>
      {loginError ? (
        <ErrorToast message={loginError} />
      ) : null}
      <PinEntry value={pin} onChange={setPin} onSubmit={() => void submit()} isBusy={isSubmitting} />
    </AuthShell>
  );
};
