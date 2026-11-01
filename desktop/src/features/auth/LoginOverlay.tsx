import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { BrandMark } from '../../ui/BrandMark';
import { Numpad } from '../../ui/Numpad';
import { Button } from '../../ui/Button';
import { formatDateTime } from '../../lib/date';

export const LoginOverlay: React.FC = () => {
  const { isAuthenticated, loginWithPin, loginError } = useAuthStore();
  const resetIdleTimer = useUIStore((state) => state.resetIdleTimer);

  const [pinDigits, setPinDigits] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clockStr, setClockStr] = useState(formatDateTime());
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClockStr(formatDateTime()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col justify-between p-6 bg-[var(--bg-canvas)] select-none"
    >
      {/* Üst Satır */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark className="w-8 h-8" surface="desk" />
          <span className="font-bold text-base tracking-tight text-[var(--text-primary)]">KASAM360</span>
        </div>
      </div>

      {/* Merkez Terminal Kartı */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className={`w-full max-w-[360px] paper border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-4 shadow-2xl ${
            shake ? 'animate-shake' : ''
          }`}
        >
          <div className="text-center">
            <h1 className="print-title text-sm font-bold text-[var(--text-primary)]">Personel Girişi</h1>
            <p className="text-xs mt-1 text-[var(--text-secondary)]">
              Devam etmek için 4-8 haneli PIN kodunuzu girin
            </p>
          </div>

          {loginError ? (
            <div className="p-3 rounded-lg text-xs font-medium text-center border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          ) : null}

          {/* PIN Ekranı */}
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-4 gap-2.5">
                {Array.from({ length: Math.max(4, pinDigits.length) }, (_, idx) => idx).map((idx) => {
                  const hasDigit = pinDigits.length > idx;
                  return (
                    <div
                      key={idx}
                      className="h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center text-xl font-bold text-[var(--text-primary)]"
                    >
                      {hasDigit ? '•' : ''}
                    </div>
                  );
                })}
              </div>

              <Numpad
                onDigit={handleDigit}
                onClear={handleClear}
                onBackspace={handleBackspace}
                buttonHeightClass="!min-h-[50px]"
              />
              <Button type="button" variant="primary" size="lg" className="w-full"
                onClick={handlePinSubmit} disabled={pinDigits.length < 4} isLoading={isSubmitting}>
                PIN ile Giriş Yap
              </Button>
            </div>
        </div>
      </div>

      {/* Alt Bilgi Satırı */}
      <div className="flex flex-wrap items-center justify-between text-xs text-[var(--text-muted)] gap-2">
        <span>İşletme PIN kodunuzu kullanın.</span>
        <span className="tabular-nums tabular-nums">{clockStr}</span>
      </div>
    </div>
  );
};
