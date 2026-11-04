import React, { useState } from 'react';
import { EmailNotVerified, verifyWebAccount, type WebAccount } from '../../lib/webAccount';
import { useSetupStore } from '../../stores/setupStore';
import { Button } from '../../ui/Button';
import { AccountLogin } from '../auth/AccountLogin';
import { AuthShell } from '../auth/AuthShell';
import { GoogleSetupButton } from './GoogleSetupButton';
import { NewBusinessForm } from './NewBusinessForm';
import { ForgotPasswordForm, RegisterForm, VerifyCodeForm, sendEmailCode } from './WebAccountForms';

type View = 'LOGIN' | 'REGISTER' | 'VERIFY' | 'FORGOT';

const VIEW_TITLES: Record<View, string> = {
  LOGIN: 'Giriş yap',
  REGISTER: 'Kayıt ol',
  VERIFY: 'E-postanı doğrula',
  FORGOT: 'Şifreni yenile',
};

export const SetupWizard: React.FC = () => {
  const { mode, draft, saveProgress } = useSetupStore();
  const [view, setView] = useState<View>('LOGIN');
  // Şifre taslağa yazılmaz: yalnız bu ekran açıkken bellekte durur.
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [verifiedPassword, setVerifiedPassword] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const fillFromAccount = (account: WebAccount) =>
    saveProgress('NEW', {
      ...draft,
      email: account.email,
      ownerName: account.name,
      businessName: account.businessName ?? draft.businessName,
      phone: account.phone ?? draft.phone,
    });

  const signInWithWebAccount = async (email: string, password: string) => {
    const account = await verifyWebAccount(email, password);
    setVerifiedPassword(password);
    await fillFromAccount(account);
  };

  const continueWithWebAccount = async (email: string, password: string) => {
    try {
      await signInWithWebAccount(email, password);
    } catch (caught) {
      if (!(caught instanceof EmailNotVerified)) throw caught;
      const sent = await sendEmailCode(email);
      if (!sent.ok) throw new Error(sent.error);
      setCredentials({ email, password });
      setView('VERIFY');
    }
  };

  const openView = (next: View) => {
    setNotice(null);
    setView(next);
  };

  const back = () => {
    setVerifiedPassword(undefined);
    setView('LOGIN');
    void saveProgress(null, draft).catch(() => undefined);
  };

  // Eski taslakta cihaz bağlama seçimi kalmış olabilir; o ekran artık yok, giriş açılır.
  const isSettingUp = mode === 'NEW';

  return (
    <AuthShell title={isSettingUp ? 'İşletmeni kur' : VIEW_TITLES[view]}>
      {!isSettingUp && view === 'LOGIN' ? (
        <AccountLogin onNotOnDevice={continueWithWebAccount} onForgot={() => openView('FORGOT')}>
          {notice ? <p role="status">{notice}</p> : null}
          <GoogleSetupButton onAccount={(account) => void fillFromAccount(account).catch(() => undefined)} />
          <Button type="button" variant="secondary" className="w-full min-h-12" onClick={() => openView('REGISTER')}>
            Kayıt Ol
          </Button>
        </AccountLogin>
      ) : null}

      {!isSettingUp && view === 'REGISTER' ? (
        <RegisterForm
          onBack={() => openView('LOGIN')}
          onRegistered={(email, password) => {
            setCredentials({ email, password });
            setView('VERIFY');
          }}
        />
      ) : null}

      {!isSettingUp && view === 'VERIFY' && credentials ? (
        <VerifyCodeForm
          email={credentials.email}
          onBack={() => openView('LOGIN')}
          onVerified={() => signInWithWebAccount(credentials.email, credentials.password)}
        />
      ) : null}

      {!isSettingUp && view === 'FORGOT' ? (
        <ForgotPasswordForm
          onBack={() => openView('LOGIN')}
          onDone={() => {
            setView('LOGIN');
            setNotice('Şifreniz değişti.');
          }}
        />
      ) : null}

      {isSettingUp ? <NewBusinessForm onBack={back} verifiedPassword={verifiedPassword} /> : null}
    </AuthShell>
  );
};
