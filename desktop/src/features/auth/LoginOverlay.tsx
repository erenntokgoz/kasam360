import React, { useState, useEffect } from 'react';
import { Sun, Moon, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Numpad } from '../../ui/Numpad';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { formatDateTime } from '../../lib/date';

export const LoginOverlay: React.FC = () => {
  const { isAuthenticated, isLocked, loginWithPin, loginWithCredentials, loginError } = useAuthStore();
  const { theme, toggleTheme, resetIdleTimer } = useUIStore();

  const [authMethod, setAuthMethod] = useState<'PIN' | 'CRED'>('PIN');
  const [pinDigits, setPinDigits] = useState<string>('');
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clockStr, setClockStr] = useState(formatDateTime());
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClockStr(formatDateTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  const shouldShow = !isAuthenticated || isLocked;
  if (!shouldShow) return null;

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

  const handleCredSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const success = await loginWithCredentials(identifier, secret);
    setIsSubmitting(false);
    if (success) {
      resetIdleTimer();
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col justify-between p-6 bg-[var(--bg-canvas)] select-none"
    >
      {/* Üst Satır */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-[var(--text-primary)] bg-[var(--accent-amber)] shadow-sm">
            360
          </div>
          <span className="font-bold text-base tracking-tight text-[var(--text-primary)]">KASAM360</span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={toggleTheme}
          className="!min-h-[38px] !px-3"
          aria-label="Tema Değiştir"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-[var(--accent-amber)]" /> : <Moon className="w-4 h-4 text-[var(--text-tertiary)]" />}
          <span>{theme === 'dark' ? 'Açık Tema' : 'Koyu Tema'}</span>
        </Button>
      </div>

      {/* Merkez Terminal Kartı */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className={`w-full max-w-[360px] bg-[var(--bg-panel)] border border-[var(--border)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl ${
            shake ? 'animate-shake' : ''
          }`}
        >
          <div className="text-center">
            <h1 className="text-base font-bold text-[var(--text-primary)]">
              {isLocked ? 'Terminal Kilitli' : 'Personel Girişi'}
            </h1>
            <p className="text-xs mt-1 text-[var(--text-secondary)]">
              Devam etmek için 4-8 haneli PIN kodunuzu girin
            </p>
          </div>

          {/* Yöntem Seçici */}
          <div className="grid grid-cols-2 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => {
                setAuthMethod('PIN');
                setPinDigits('');
              }}
              className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                authMethod === 'PIN'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              PIN Girişi
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod('CRED')}
              className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                authMethod === 'CRED'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Hesap Girişi
            </button>
          </div>

          {loginError ? (
            <div className="p-3 rounded-lg text-xs font-medium text-center border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          ) : null}

          {/* PIN Ekranı */}
          {authMethod === 'PIN' ? (
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
          ) : (
            <form onSubmit={handleCredSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
                  E-posta veya Kullanıcı Adı
                </label>
                <Input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="ornek@isletme.com"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
                  Şifre
                </label>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" variant="primary" size="lg" className="w-full mt-1" isLoading={isSubmitting}>
                Giriş Yap
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Alt Bilgi Satırı */}
      <div className="flex flex-wrap items-center justify-between text-xs text-[var(--text-muted)] gap-2">
        <span>İşletme PIN kodunuzu kullanın.</span>
        <span className="tabular-nums font-mono">{clockStr}</span>
      </div>
    </div>
  );
};
