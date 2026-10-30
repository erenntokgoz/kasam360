import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

interface AccountLoginProps {
  /** Web kaydı gelene kadar bu cihazda kurulum açar; sonra web adresine gider. */
  onRegister?: () => void;
  onJoinDevice?: () => void;
  onSignedIn?: () => Promise<void> | void;
}

/** Ürüne ilk giriş: işletme hesabı. Personel bundan sonra PIN ile çalışır. */
export const AccountLogin: React.FC<AccountLoginProps> = ({ onRegister, onJoinDevice, onSignedIn }) => {
  const { signIn } = useDeviceSessionStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      await onSignedIn?.();
    } catch (caught) {
      setError(errorText(caught));
      setPassword('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className="p-3 rounded-lg text-xs font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div>
        <label htmlFor="account-email" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          E-posta
        </label>
        <Input
          id="account-email"
          type="email"
          className="min-h-12"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="account-password" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
          Şifre
        </label>
        <Input
          id="account-password"
          type="password"
          className="min-h-12"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <Button type="submit" variant="primary" className="w-full min-h-12" isLoading={isBusy}>
        Giriş Yap
      </Button>
      {onRegister || onJoinDevice ? (
        <div className="grid grid-cols-2 gap-2">
          {onRegister ? (
            <Button type="button" variant="secondary" className="min-h-12" onClick={onRegister}>
              Kayıt Ol
            </Button>
          ) : null}
          {onJoinDevice ? (
            <Button type="button" variant="secondary" className="min-h-12" onClick={onJoinDevice}>
              Cihazı Bağla
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
};
