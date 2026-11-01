import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Numpad } from '../../ui/Numpad';
import { Button } from '../../ui/Button';
import { AuthLayout } from './AuthLayout';

export const LoginOverlay: React.FC = () => {
  const { isAuthenticated, loginWithPin, loginError } = useAuthStore();
  const { resetIdleTimer } = useUIStore();

  const [pinDigits, setPinDigits] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  if (isAuthenticated) return null;

  const handleDigit = (d: string) => {
    if (pinDigits.length < 8) setPinDigits((current) => current + d);
  };

  const handlePinSubmit = async () => {
    if (pinDigits.length < 4 || isSubmitting) return;
    setIsSubmitting(true);
    const success = await loginWithPin(pinDigits);
    setIsSubmitting(false);
    if (success) {
      setPinDigits('');
      resetIdleTimer();
    } else {
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPinDigits('');
      }, 500);
    }
  };

  const handleClear = () => setPinDigits('');
  const handleBackspace = () => setPinDigits((prev) => prev.slice(0, -1));

  return (
    <AuthLayout title="Sıradaki adisyon sende." subtitle="Vardiyana başlamak için PIN kodunu gir.">
      <div className={`flex flex-col gap-4 ${shake ? 'animate-shake' : ''}`}>
        <h2 className="print-title text-2xl">Personel Girişi</h2>
        {loginError ? (
          <div role="alert" className="p-3 rounded-md text-sm font-semibold border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loginError}</span>
          </div>
        ) : null}
        <div className="flex justify-center gap-4 h-8 items-center" aria-label={`${pinDigits.length} hane girildi`}>
          {Array.from({ length: Math.max(4, pinDigits.length) }, (_, idx) => (
            <span
              key={idx}
              className={`w-5 h-5 rounded-full border-2 border-[var(--print)] ${pinDigits.length > idx ? 'bg-[var(--print)]' : ''}`}
            />
          ))}
        </div>
        <Numpad onDigit={handleDigit} onClear={handleClear} onBackspace={handleBackspace} />
        <Button type="button" variant="primary" size="lg" className="w-full" onClick={handlePinSubmit} disabled={pinDigits.length < 4} isLoading={isSubmitting}>
          Giriş Yap
        </Button>
      </div>
    </AuthLayout>
  );
};
