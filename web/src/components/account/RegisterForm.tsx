'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { authPost, type FieldErrors } from '@/lib/authApi';
import { markSent } from '@/lib/verificationResend';
import { FormError, GoogleButton, SecureForm, SubmitButton, TextField } from './FormParts';

const FIELD_ORDER = ['name', 'businessName', 'email', 'phone', 'password', 'consent'];

export function RegisterForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setErrors({});
    setIsBusy(true);
    const data = new FormData(event.currentTarget);
    const result = await authPost('/sign-up/email', {
      name: data.get('name'),
      businessName: data.get('businessName'),
      email: data.get('email'),
      phone: data.get('phone'),
      password: data.get('password'),
      consent: data.get('consent') === 'on',
      callbackURL: '/hesabim?dogrulandi=1',
    });
    setIsBusy(false);
    if (result.ok) {
      // Kayıtta sunucu doğrulama postasını zaten gönderdi; sayaç buradan başlar.
      markSent(String(data.get('email') ?? ''));
      setIsDone(true);
      return;
    }
    const fieldErrors = result.errors ?? {};
    setErrors(fieldErrors);
    setFormError(result.error ?? '');
    const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (firstInvalid) formRef.current?.querySelector<HTMLElement>(`#${firstInvalid}`)?.focus();
  };

  if (isDone) {
    return (
      <div className="k-done" role="status">
        <b>Kayıt alındı.</b>
        <p>E-postanıza doğrulama bağlantısı gönderdik. Bağlantı 1 saat geçerlidir. Mail gelmezse spam kutusuna bakın veya giriş yapmayı deneyin, bağlantıyı yeniden göndeririz.</p>
      </div>
    );
  }

  return (
    <div className="k-stack">
      <GoogleButton onError={setFormError} />
      <p className="k-muted k-small" style={{ margin: 0 }}>
        Google ile devam ederek{' '}
        <Link href="/kullanim-sartlari" className="k-link">
          kullanım şartlarını
        </Link>{' '}
        ve{' '}
        <Link href="/kvkk" className="k-link">
          aydınlatma metnini
        </Link>{' '}
        kabul etmiş olursunuz.
      </p>

      <p className="k-divider">ya da e-postayla</p>

      <SecureForm fallbackPath="/kayit" ref={formRef} onSubmit={handleSubmit} noValidate className="k-stack">
        <div className="k-grid-2">
          <TextField id="name" label="Ad soyad" autoComplete="name" placeholder="Ayşe Yılmaz…" error={errors.name} />
          <TextField id="businessName" label="İşletme adı" autoComplete="organization" placeholder="Liman Lokantası…" error={errors.businessName} />
          <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" placeholder="ayse@ornek.com…" />
          <TextField id="phone" label="Telefon (isteğe bağlı)" type="tel" inputMode="tel" autoComplete="tel" placeholder="0532 000 00 00…" error={errors.phone} />
        </div>
        <TextField id="password" label="Şifre (en az 8 karakter)" type="password" autoComplete="new-password" />

        <div className="k-field">
          <label htmlFor="consent" className="k-check">
            <input id="consent" name="consent" type="checkbox" aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'consent-error' : undefined} />
            <span>
              <Link href="/kullanim-sartlari" className="k-link">
                Kullanım şartlarını
              </Link>{' '}
              ve{' '}
              <Link href="/kvkk" className="k-link">
                aydınlatma metnini
              </Link>{' '}
              okudum. Bilgilerimin hesabım için işlenmesini ve hizmet sağlayıcıların yurt dışındaki sunucularına aktarılmasını kabul ediyorum.
            </span>
          </label>
          {errors.consent && <p id="consent-error" className="k-field-error">{errors.consent}</p>}
        </div>

        <FormError message={formError} />

        <SubmitButton className="k-btn k-btn-buy k-btn-block k-btn-lg" disabled={isBusy}>
          {isBusy ? 'Gönderiliyor…' : 'Kayıt ol'}
        </SubmitButton>
      </SecureForm>

      <p className="k-muted k-small" style={{ margin: 0 }}>
        Hesabınız var mı?{' '}
        <Link href="/giris" className="k-link">
          Giriş yapın
        </Link>
      </p>
    </div>
  );
}
