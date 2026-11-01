import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { AccountLogin } from './AccountLogin';
import { AuthLayout } from './AuthLayout';

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
      <Input aria-label="Sahip PIN" type="password" inputMode="numeric" placeholder="Sahip PIN" className="min-h-12" value={ownerPin} onChange={(event) => setOwnerPin(event.target.value)} required />
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
    <AuthLayout title="İşletme hesabına gir." subtitle="Bu cihaz hesabına bağlandıktan sonra personel PIN ile çalışır.">
      <h2 className="print-title text-2xl">Giriş</h2>
      {error ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-[var(--accent-red)] break-words">{error}</p>
          <Button variant="primary" className="w-full" onClick={() => void load()}>
            Yeniden Dene
          </Button>
        </div>
      ) : session?.accountMissing ? (
        <CreateAccountForm />
      ) : (
        <AccountLogin />
      )}
    </AuthLayout>
  );
};
