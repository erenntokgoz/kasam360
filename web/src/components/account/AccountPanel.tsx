'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { authGet, authPost, type FieldErrors } from '@/lib/authApi';
import { FormError, TextField } from './FormParts';

interface AccountUser {
  name: string;
  email: string;
  businessName?: string | null;
  phone?: string | null;
}

interface Session {
  user: AccountUser;
}

function ProfileForm({ user }: { user: AccountUser }) {
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    setErrors({});
    setFormError('');
    setIsBusy(true);
    const data = new FormData(event.currentTarget);
    const result = await authPost('/update-user', {
      name: data.get('name'),
      businessName: data.get('businessName'),
      phone: data.get('phone'),
    });
    setIsBusy(false);
    if (result.ok) setNotice('Bilgileriniz kaydedildi.');
    setErrors(result.errors ?? {});
    setFormError(result.error ?? '');
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="name" label="Ad soyad" autoComplete="name" defaultValue={user.name} error={errors.name} />
        <TextField id="businessName" label="İşletme adı" autoComplete="organization" defaultValue={user.businessName ?? ''} error={errors.businessName} />
        <TextField id="email" label="E-posta" type="email" value={user.email} readOnly />
        <TextField id="phone" label="Telefon (isteğe bağlı)" type="tel" inputMode="tel" autoComplete="tel" defaultValue={user.phone ?? ''} error={errors.phone} />
      </div>
      <FormError message={formError} />
      {notice && <p role="status">{notice}</p>}
      <button type="submit" className="btn self-start" disabled={isBusy}>
        {isBusy ? 'Kaydediliyor…' : 'Bilgileri Kaydet'}
      </button>
    </form>
  );
}

function ChangePasswordForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    setFormError('');
    setIsBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await authPost('/change-password', {
      currentPassword: data.get('currentPassword'),
      newPassword: data.get('newPassword'),
      revokeOtherSessions: true,
    });
    setIsBusy(false);
    if (result.ok) {
      form.reset();
      setNotice('Şifreniz değişti. Diğer cihazlardaki oturumlar kapatıldı.');
    } else {
      setFormError(result.error ?? '');
    }
  };

  // Şifre değiştirmek isteğe bağlıdır; hesaba ilk gelene mevcut şifre sorulmaz.
  if (!isOpen) {
    return (
      <button type="button" className="btn btn-paper self-start border border-print" onClick={() => setIsOpen(true)}>
        Şifre Değiştir
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 className="text-xl font-bold">Şifre değiştir</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="currentPassword" label="Mevcut şifre" type="password" autoComplete="current-password" required />
        <TextField id="newPassword" label="Yeni şifre (en az 8 karakter)" type="password" autoComplete="new-password" required />
      </div>
      <FormError message={formError} />
      {notice && <p role="status">{notice}</p>}
      <button type="submit" className="btn self-start" disabled={isBusy}>
        {isBusy ? 'Kaydediliyor…' : 'Şifreyi Değiştir'}
      </button>
    </form>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setIsBusy(true);
    const password = new FormData(event.currentTarget).get('deletePassword');
    const result = await authPost('/delete-user', hasPassword ? { password } : {});
    if (result.ok) {
      window.location.assign('/');
      return;
    }
    setIsBusy(false);
    setFormError(result.error ?? '');
  };

  if (!isOpen) {
    return (
      <button type="button" className="text-link self-start text-sm" onClick={() => setIsOpen(true)}>
        Hesabı sil
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-ink-soft">Hesabınız ve bilgileriniz kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
      {hasPassword && <TextField id="deletePassword" label="Şifreniz" type="password" autoComplete="current-password" required />}
      <FormError message={formError} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn" disabled={isBusy}>
          {isBusy ? 'Siliniyor…' : 'Hesabı Kalıcı Olarak Sil'}
        </button>
        <button type="button" className="btn btn-paper border border-print" onClick={() => setIsOpen(false)}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

export function AccountPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await authGet<Session | null>('/get-session');
      if (!result.ok) {
        setLoadError(result.error ?? '');
        return;
      }
      if (!result.data) {
        // Doğrulama bağlantısı hatası da buraya döner; açıklaması giriş ekranında gösterilir.
        window.location.replace(`/giris${window.location.search}`);
        return;
      }
      const accounts = await authGet<{ providerId: string }[]>('/list-accounts');
      setHasPassword(accounts.data?.some((account) => account.providerId === 'credential') ?? false);
      setSession(result.data);
      if (new URLSearchParams(window.location.search).has('dogrulandi')) {
        setJustVerified(true);
        window.history.replaceState(null, '', '/hesabim');
      }
    })();
  }, []);

  const signOut = async () => {
    await authPost('/sign-out', {});
    window.location.assign('/');
  };

  if (loadError) return <FormError message={loadError} />;
  if (!session) return <p role="status">Yükleniyor…</p>;

  return (
    <div className="flex flex-col gap-8">
      {justVerified && (
        <div className="flex flex-col gap-2" role="status">
          <p className="rubber-stamp self-start text-2xl">HESAP AÇILDI</p>
          <p className="text-ink-soft">E-postanız doğrulandı. Aşağıdaki bilgileri kontrol edin.</p>
        </div>
      )}
      <ProfileForm user={session.user} />
      {hasPassword ? <ChangePasswordForm /> : <p className="text-ink-soft">Bu hesaba Google ile giriş yapıyorsunuz.</p>}
      <div className="form-row grid-cols-[1fr_auto]">
        <span>Abonelik</span>
        <span className="font-bold">Yakında</span>
      </div>
      <button type="button" className="btn btn-paper self-start border border-print" onClick={() => void signOut()}>
        Çıkış Yap
      </button>
      <DeleteAccount hasPassword={hasPassword} />
    </div>
  );
}
