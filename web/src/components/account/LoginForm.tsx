'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { authGet, authPost } from '@/lib/authApi';
import { RESEND_COOLDOWN_MS, lastSentAt, sendVerificationMail } from '@/lib/verificationResend';
import { FormError, GoogleButton, SecureForm, SubmitButton, TextField } from './FormParts';
import { ResendVerification } from './ResendVerification';

const LINK_ERRORS: Record<string, string> = {
  account_not_linked: 'Bu e-postayla açılmış hesap henüz doğrulanmadı. Gelen kutunuzdaki bağlantıyı açın ya da aşağıdan yenisini isteyin.',
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
  const [email, setEmail] = useState('');
  const [unverified, setUnverified] = useState(linkError === 'account_not_linked');

  // Google dönüşünde veya tarayıcı adresi doldurduğunda da: son bağlantı 2 dk'dan eskiyse yenisi gider.
  useEffect(() => {
    if (!unverified || !/^\S+@\S+\.\S+$/.test(email.trim()) || Date.now() - lastSentAt(email) <= RESEND_COOLDOWN_MS) return;
    const timer = window.setTimeout(() => {
      void sendVerificationMail(email).then((sent) => {
        if (sent.ok) setFormError(`E-postanız henüz doğrulanmadı. ${email.trim()} adresine yeni doğrulama bağlantısı gönderdik.`);
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [unverified, email]);

  useEffect(() => {
    void authGet('/get-session').then((result) => {
      if (result.data) window.location.replace('/hesabim');
    });
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setUnverified(false);
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
    if (result.code === 'EMAIL_NOT_VERIFIED') {
      // Son bağlantı iki dakikadan eskiyse kullanıcı istemeden yenisi gönderilir.
      const address = String(data.get('email') ?? '');
      setUnverified(true);
      if (Date.now() - lastSentAt(address) > RESEND_COOLDOWN_MS) {
        const sent = await sendVerificationMail(address);
        setIsBusy(false);
        setFormError(sent.ok
          ? `E-postanız henüz doğrulanmadı. ${address} adresine yeni doğrulama bağlantısı gönderdik.`
          : (result.error ?? ''));
        return;
      }
    }
    setIsBusy(false);
    setFormError(result.error ?? '');
  };

  return (
    <div className="k-stack">
      <GoogleButton onError={setFormError} />
      <p className="k-divider">ya da e-postayla</p>
      <SecureForm fallbackPath="/giris" onSubmit={handleSubmit} className="k-stack"
        onInput={(event) => { const target = event.target as HTMLInputElement; if (target.name === 'email') setEmail(target.value); }}>
        <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" required />
        <TextField id="password" label="Şifre" type="password" autoComplete="current-password" required />
        <FormError message={formError} />
        {unverified && <ResendVerification email={email} />}
        <SubmitButton className="k-btn k-btn-ink k-btn-block k-btn-lg" disabled={isBusy}>
          {isBusy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </SubmitButton>
      </SecureForm>
      <div className="k-row k-small" style={{ justifyContent: 'space-between' }}>
        <Link href="/sifremi-unuttum" className="k-link">
          Şifremi unuttum
        </Link>
        <Link href="/kayit" className="k-link">
          Yeni hesap açın
        </Link>
      </div>
    </div>
  );
}
