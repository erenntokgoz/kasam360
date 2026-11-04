'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { authGet, authPost } from '@/lib/authApi';
import { FormError, GoogleButton, TextField } from './FormParts';

const LINK_ERRORS: Record<string, string> = {
  account_not_linked: 'Bu e-postayla açılmış hesap henüz doğrulanmadı. Önce gelen kutunuzdaki bağlantıyı açın.',
  invalid_token: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Giriş yapın, yeni bağlantı gönderelim.',
  token_expired: 'Doğrulama bağlantısının süresi dolmuş. Giriş yapın, yeni bağlantı gönderelim.',
  USER_NOT_FOUND: 'Bu bağlantının hesabı bulunamadı. Yeniden kayıt olun.',
  invalid_code: 'Google girişi tamamlanamadı. Tekrar deneyin.',
};

export function LoginForm({ linkError }: { linkError?: string }) {
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState(
    linkError ? (LINK_ERRORS[linkError] ?? 'Giriş tamamlanamadı. Tekrar deneyin.') : '',
  );

  useEffect(() => {
    void authGet('/get-session').then((result) => {
      if (result.data) window.location.replace('/hesabim');
    });
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setIsBusy(true);
    const data = new FormData(event.currentTarget);
    const result = await authPost('/sign-in/email', {
      email: data.get('email'),
      password: data.get('password'),
      callbackURL: '/hesabim?dogrulandi=1',
    });
    if (result.ok) {
      window.location.assign('/hesabim');
      return;
    }
    setIsBusy(false);
    setFormError(result.error ?? '');
  };

  return (
    <div className="flex flex-col gap-5">
      <GoogleButton onError={setFormError} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" required />
        <TextField id="password" label="Şifre" type="password" autoComplete="current-password" required />
        <FormError message={formError} />
        <button type="submit" className="btn" disabled={isBusy}>
          {isBusy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </button>
      </form>
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-sm">
        <Link href="/sifremi-unuttum" className="text-link">
          Şifremi unuttum
        </Link>
        <Link href="/kayit" className="text-link">
          Yeni hesap açın
        </Link>
      </div>
    </div>
  );
}
