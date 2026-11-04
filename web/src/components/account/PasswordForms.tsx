'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authPost } from '@/lib/authApi';
import { FormError, TextField } from './FormParts';

export function ForgotPasswordForm() {
  const [isBusy, setIsBusy] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setIsBusy(true);
    const email = new FormData(event.currentTarget).get('email');
    const result = await authPost('/request-password-reset', { email, redirectTo: '/sifre-yenile' });
    setIsBusy(false);
    if (result.ok) setIsDone(true);
    else setFormError(result.error ?? '');
  };

  if (isDone) {
    return (
      <p className="text-ink-soft" role="status">
        Bu e-postayla bir hesap varsa şifre yenileme bağlantısı gönderdik. Bağlantı 1 saat geçerlidir.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" required />
      <FormError message={formError} />
      <button type="submit" className="btn" disabled={isBusy}>
        {isBusy ? 'Gönderiliyor…' : 'Bağlantı Gönder'}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const [isBusy, setIsBusy] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [formError, setFormError] = useState(token ? '' : 'Bağlantı geçersiz veya süresi dolmuş. Yeni bağlantı isteyin.');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setIsBusy(true);
    const newPassword = new FormData(event.currentTarget).get('password');
    const result = await authPost('/reset-password', { newPassword, token });
    setIsBusy(false);
    if (result.ok) setIsDone(true);
    else setFormError(result.error ?? '');
  };

  if (isDone) {
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="text-ink-soft">Şifreniz değişti. Diğer cihazlardaki oturumlar kapatıldı.</p>
        <Link href="/giris" className="btn self-start">
          Giriş Yap
        </Link>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-3">
        <FormError message={formError} />
        <Link href="/sifremi-unuttum" className="text-link">
          Yeni bağlantı iste
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <TextField id="password" label="Yeni şifre (en az 8 karakter)" type="password" autoComplete="new-password" required />
      <FormError message={formError} />
      <button type="submit" className="btn" disabled={isBusy}>
        {isBusy ? 'Kaydediliyor…' : 'Şifreyi Değiştir'}
      </button>
    </form>
  );
}
