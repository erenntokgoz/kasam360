import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { Input } from '../../ui/Input';
import { EmailNotVerified, verifyWebAccount, type WebAccount } from '../../lib/webAccount';
import { shouldAutoResend } from '../../lib/verificationResend';
import { useSetupStore } from '../../stores/setupStore';
import { Button } from '../../ui/Button';
import { AccountLogin } from '../auth/AccountLogin';
import { AuthShell } from '../auth/AuthShell';
import { GoogleSetupButton } from './GoogleSetupButton';
import { NewBusinessForm } from './NewBusinessForm';
import { listCloudTenants, restoreFromCloud, type CloudTenant } from './cloudRestore';
import { TenantChoiceForm } from './TenantChoiceForm';
import { ForgotPasswordForm, RegisterForm, VerifyCodeForm, sendEmailCode } from './WebAccountForms';

type View = 'LOGIN' | 'REGISTER' | 'VERIFY' | 'FORGOT' | 'JOIN' | 'RESTORE' | 'CHOOSE';

const VIEW_TITLES: Record<View, string> = {
  LOGIN: 'Giriş yap',
  REGISTER: 'Kayıt ol',
  VERIFY: 'E-postanı doğrula',
  FORGOT: 'Şifreni yenile',
  JOIN: 'Cihazı Bağla',
  RESTORE: 'Yedekten Kur',
  CHOOSE: 'İşletmeni seç',
};

export const SetupWizard: React.FC = () => {
  const { mode, draft, saveProgress, joinExisting } = useSetupStore();
  const [view, setView] = useState<View>('LOGIN');
  // Şifre taslağa yazılmaz: yalnız bu ekran açıkken bellekte durur.
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [verifiedPassword, setVerifiedPassword] = useState<string | undefined>();
  const [recoveryValue, setRecoveryValue] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenants, setTenants] = useState<CloudTenant[]>([]);

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

  // İşletme buluttaysa boş kasaya indirilir; değilse kurulum hesap bilgisiyle sürer.
  const continueWithWebAccount = async (email: string, password: string) => {
    if (await restoreFromCloud(email, password, (rows) => setNotice(`İndirilen kayıt: ${rows}`))) {
      setNotice(null);
      return;
    }
    // Hesabın buluttaki işletmesi varsa yeni işletme kendiliğinden kurulmaz; kullanıcı seçer.
    const existing = await listCloudTenants().catch(() => [] as CloudTenant[]);
    if (existing.length > 0) {
      setCredentials({ email, password });
      setTenants(existing);
      setView('CHOOSE');
      return;
    }
    try {
      await signInWithWebAccount(email, password);
    } catch (caught) {
      if (!(caught instanceof EmailNotVerified)) throw caught;
      // İki dakikadan yeni kod hâlâ geçerli; eskiyse ve girilmemişse yenisi kendiliğinden gönderilir.
      if (shouldAutoResend(email)) {
        const sent = await sendEmailCode(email);
        if (!sent.ok) throw new Error(sent.error);
      }
      setCredentials({ email, password });
      setView('VERIFY');
    }
  };

  const openView = (next: View) => {
    setNotice(null);
    setRecoveryError(null);
    setRecoveryValue('');
    setView(next);
  };

  const back = () => {
    setVerifiedPassword(undefined);
    setView('LOGIN');
    void saveProgress(null, draft).catch(() => undefined);
  };

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
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => openView('JOIN')}>Cihazı Bağla</Button>
            <Button type="button" variant="ghost" onClick={() => openView('RESTORE')}>Yedekten Kur</Button>
          </div>
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

      {!isSettingUp && (view === 'JOIN' || view === 'RESTORE') ? (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (recoveryBusy || !recoveryValue.trim() || (view === 'JOIN' && !deviceName.trim())) return;
          setRecoveryBusy(true);
          setRecoveryError(null);
          const task = view === 'JOIN'
            ? joinExisting(recoveryValue.trim(), deviceName.trim())
            : invokeIPC('restore_backup_on_setup', { filePath: recoveryValue.trim().replace(/^"|"$/g, '') });
          void task.catch((caught) => setRecoveryError(errorText(caught))).finally(() => setRecoveryBusy(false));
        }}>
          {view === 'JOIN' ? <label className="block space-y-1"><span className="text-sm font-semibold">Cihaz adı</span>
            <Input aria-label="Cihaz adı" required disabled={recoveryBusy}
              value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label> : null}
          <label className="block space-y-1"><span className="text-sm font-semibold">{view === 'JOIN' ? 'Eşleştirme kodu' : 'Yedek dosyasının tam yolu'}</span>
            <Input aria-label={view === 'JOIN' ? 'Eşleştirme kodu' : 'Yedek dosyasının tam yolu'}
              required disabled={recoveryBusy} value={recoveryValue} onChange={(event) => setRecoveryValue(event.target.value)} /></label>
          {recoveryError ? <ErrorToast message={recoveryError} /> : null}
          <div className="flex gap-2">
            <Button type="button" disabled={recoveryBusy} onClick={() => openView('LOGIN')}>Geri</Button>
            <Button type="submit" variant="primary" isLoading={recoveryBusy}>{view === 'JOIN' ? 'Bağla' : 'Geri Yükle'}</Button>
          </div>
        </form>
      ) : null}

      {!isSettingUp && view === 'CHOOSE' && credentials ? (
        <TenantChoiceForm
          email={credentials.email}
          tenants={tenants}
          onBack={() => openView('LOGIN')}
          onNewBusiness={() => signInWithWebAccount(credentials.email, credentials.password)}
          onSetupForTenant={async (tenant) => {
            await signInWithWebAccount(credentials.email, credentials.password);
            await saveProgress('NEW', { ...useSetupStore.getState().draft, businessName: tenant.name });
          }}
        />
      ) : null}

      {isSettingUp ? <NewBusinessForm onBack={back} verifiedPassword={verifiedPassword} /> : null}
    </AuthShell>
  );
};
