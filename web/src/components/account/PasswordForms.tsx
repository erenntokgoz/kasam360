'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authPost } from '@/lib/authApi';
import { FormError, SecureForm, SubmitButton, TextField } from './FormParts';

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
      <div className="k-done" role="status">
        <b>Bağlantı gönderildi.</b>
        <p>Bu e-postayla bir hesap varsa şifre yenileme bağlantısı gönderdik. Bağlantı 1 saat geçerlidir.</p>
      </div>
    );
  }

  return (
    <SecureForm fallbackPath="/sifremi-unuttum" onSubmit={handleSubmit} className="k-stack">
      <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" required />
      <FormError message={formError} />
      <SubmitButton className="k-btn k-btn-ink k-btn-block k-btn-lg" disabled={isBusy}>
        {isBusy ? 'Gönderiliyor…' : 'Bağlantı gönder'}
      </SubmitButton>
    </SecureForm>
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
      <div className="k-stack" role="status">
        <div className="k-done">
          <b>Şifreniz değişti.</b>
          <p>Diğer cihazlardaki oturumlar kapatıldı.</p>
        </div>
        <Link href="/giris" className="k-btn k-btn-ink k-btn-lg">
          Giriş yap
        </Link>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="k-stack">
        <FormError message={formError} />
        <Link href="/sifremi-unuttum" className="k-link">
          Yeni bağlantı iste
        </Link>
      </div>
    );
  }

  return (
    <SecureForm fallbackPath="/sifre-yenile" onSubmit={handleSubmit} className="k-stack">
      <TextField id="password" label="Yeni şifre (en az 8 karakter)" type="password" autoComplete="new-password" required />
      <FormError message={formError} />
      <SubmitButton className="k-btn k-btn-ink k-btn-block k-btn-lg" disabled={isBusy}>
        {isBusy ? 'Kaydediliyor…' : 'Şifreyi değiştir'}
      </SubmitButton>
    </SecureForm>
  );
}
