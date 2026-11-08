import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

interface AccountLoginProps {
  /** Kurulmamış cihazda hesap sitededir; giriş denemesi buraya düşer. */
  onNotOnDevice?: (email: string, password: string) => Promise<void>;
  /** Şifre hesabı sitede yeniler; kurulu cihazın yerel şifresini değiştirmez. */
  onForgot?: () => void;
  children?: React.ReactNode;
}

/** Sitedeki sabit sayfaları sistem tarayıcısında açar. */
export const openSitePage = (path: string) => invokeIPC('open_site_page', { path });

/** Ürüne ilk giriş: işletme hesabı. Personel bundan sonra PIN ile çalışır. */
export const AccountLogin: React.FC<AccountLoginProps> = ({ onNotOnDevice, onForgot, children }) => {
  const { signIn } = useDeviceSessionStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      try {
        await signIn(email, password);
      } catch (caught) {
        if (!onNotOnDevice || !String(caught).includes('ACCOUNT_NOT_ON_DEVICE')) throw caught;
        await onNotOnDevice(email, password);
      }
    } catch (caught) {
      setError(errorText(caught));
      setPassword('');
    } finally {
      setIsBusy(false);
    }
  };

  const readCapsLock = (event: React.KeyboardEvent) => setCapsLock(event.getModifierState('CapsLock'));

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      {error ? (
        <ErrorToast message={error} />
      ) : null}
      <div>
        <label htmlFor="account-email" className="block text-sm font-medium mb-1 text-[var(--text-secondary)]">
          E-posta
        </label>
        <Input
          id="account-email"
          type="email"
          className="min-h-12"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <label htmlFor="account-password" className="text-sm font-medium text-[var(--text-secondary)]">
            Şifre
          </label>
          {onForgot ? (
            <button type="button" className="text-sm font-medium underline text-[var(--text-secondary)]" onClick={onForgot}>
              Şifremi unuttum
            </button>
          ) : null}
        </div>
        <div className="relative">
          <Input
            id="account-password"
            type={showPassword ? 'text' : 'password'}
            className="min-h-12 pr-12"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={readCapsLock}
            onKeyDown={readCapsLock}
            required
          />
          <button
            type="button"
            aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
            className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-[var(--text-secondary)]"
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
        {capsLock ? <p className="mt-1 text-sm font-medium text-[var(--accent-red)]">Büyük harf kilidi açık.</p> : null}
      </div>
      <Button type="submit" variant="primary" className="w-full min-h-12" isLoading={isBusy}>
        Giriş Yap
      </Button>
      {children}
    </form>
  );
};
