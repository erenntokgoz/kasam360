import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { AccountLogin } from './AccountLogin';

/** Sahibi henüz hesabı olmayan eski işletme: kimliği sahip PIN'i kanıtlar. */
const CreateAccountForm: React.FC = () => {
  const { createAccount } = useDeviceSessionStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await createAccount(email, password, ownerPin);
    } catch (caught) {
      setError(errorText(caught));
      setOwnerPin('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <p className="text-xs text-[var(--text-secondary)]">
        Bu işletmede hesap yok. Sahip PIN kodunuzla e-posta ve şifre belirleyin.
      </p>
      {error ? (
        <div role="alert" className="p-3 rounded-lg text-xs font-medium border bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red-border)] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <Input aria-label="E-posta" type="email" placeholder="E-posta" className="min-h-12" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <Input aria-label="Şifre" type="password" placeholder="Şifre (en az 8 karakter)" className="min-h-12" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <NumberInput kind="digits" aria-label="Sahip PIN" type="password" placeholder="Sahip PIN" className="min-h-12" value={ownerPin} onValueChange={setOwnerPin} required />
      <Button type="submit" variant="primary" className="w-full min-h-12" isLoading={isBusy}>
        Hesabı Oluştur
      </Button>
    </form>
  );
};

/** Kurulu cihazda hesap oturumu yoksa görünür; personel PIN ekranının önündedir. */
export const AccountGate: React.FC = () => {
  const { session, error, load } = useDeviceSessionStore();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-canvas)] p-6 select-none">
      <div className="min-h-full flex items-center justify-center">
        <div className="w-full max-w-[400px] paper border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-4">
          <h1 className="print-title font-bold text-base tracking-tight text-[var(--text-primary)]">KASAM360 Giriş</h1>
          {error ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-[var(--accent-red)] break-words">{error}</p>
              <Button variant="primary" className="w-full min-h-12" onClick={() => void load()}>
                Yeniden Dene
              </Button>
            </div>
          ) : session?.accountMissing ? (
            <CreateAccountForm />
          ) : (
            <AccountLogin />
          )}
        </div>
      </div>
    </div>
  );
};
