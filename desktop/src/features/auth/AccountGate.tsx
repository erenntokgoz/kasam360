import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { NumberInput } from '../../ui/NumberInput';
import { errorText } from '../../lib/cariInput';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';
import { AccountLogin } from './AccountLogin';
import { AuthShell } from './AuthShell';
import { GoogleDeviceButton } from './GoogleDeviceButton';

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
      {error ? (
        <ErrorToast message={error} />
      ) : null}
      <label className="block space-y-1"><span className="text-sm font-semibold">E-posta</span>
        <Input aria-label="E-posta" type="email" className="min-h-12" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label className="block space-y-1"><span className="text-sm font-semibold">Şifre</span>
        <Input aria-label="Şifre" type="password" className="min-h-12" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <label className="block space-y-1"><span className="text-sm font-semibold">Sahip PIN</span>
        <NumberInput kind="digits" aria-label="Sahip PIN" type="password" className="min-h-12" value={ownerPin} onValueChange={setOwnerPin} required />
      </label>
      <Button type="submit" variant="primary" className="w-full min-h-12" isLoading={isBusy}>
        Hesabı Oluştur
      </Button>
    </form>
  );
};

/** Çıkış yarımsa: kaç işlem buluta gitmedi ve bulutun söylediği neden. Kapanmaz, yeniden denenebilir. */
const ExitBlockNotice: React.FC = () => {
  const { exitBlock, retryExit, refreshExitBlock } = useDeviceSessionStore();
  const [isBusy, setIsBusy] = useState(false);
  useEffect(() => { void refreshExitBlock(); }, [refreshExitBlock]);
  if (!exitBlock) return null;
  const reason = exitBlock.message ? ` Bulut: ${exitBlock.message}` : '';
  const text = `Çıkış tamamlanmadı: ${exitBlock.pending} işlem buluta henüz gitmedi, bu yüzden bu kasadaki veri silinmedi. Başka hesapla girmek için işlemlerin gitmesi gerekir.${reason}`;
  return (
    <div className="flex flex-col gap-2">
      <InlineAlert message={text} />
      <Button
        type="button"
        variant="secondary"
        className="w-full min-h-12"
        isLoading={isBusy}
        onClick={() => { setIsBusy(true); void retryExit().finally(() => setIsBusy(false)); }}
      >
        Şimdi göndermeyi dene
      </Button>
    </div>
  );
};

/** Kurulu cihazda hesap oturumu yoksa görünür; personel PIN ekranının önündedir. */
export const AccountGate: React.FC = () => {
  const { session, error, load } = useDeviceSessionStore();

  return (
    <AuthShell title={session?.accountMissing ? 'Hesap oluştur' : 'İşletme girişi'}>
      {error ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">İşletme oturumu okunamadı.</p>
          <ErrorToast message={error} />
          <Button variant="primary" className="w-full min-h-12" onClick={() => void load()}>
            Yeniden Dene
          </Button>
        </div>
      ) : session?.accountMissing ? (
        <CreateAccountForm />
      ) : (
        <AccountLogin notice={<ExitBlockNotice />}>
          <GoogleDeviceButton />
        </AccountLogin>
      )}
    </AuthShell>
  );
};
