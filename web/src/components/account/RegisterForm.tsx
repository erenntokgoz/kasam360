'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { authPost, type FieldErrors } from '@/lib/authApi';
import { FormError, GoogleButton, TextField } from './FormParts';

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
      <div className="flex flex-col gap-3" role="status">
        <p className="rubber-stamp self-start text-2xl">KAYIT ALINDI</p>
        <p className="text-ink-soft">E-postanıza doğrulama bağlantısı gönderdik. Bağlantı 1 saat geçerlidir. Mail gelmezse spam kutusuna bakın veya giriş yapmayı deneyin, bağlantıyı yeniden göndeririz.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <GoogleButton onError={setFormError} />
      <p className="text-sm text-ink-soft">
        Google ile devam ederek{' '}
        <Link href="/kullanim-sartlari" className="text-link">
          kullanım şartlarını
        </Link>{' '}
        ve{' '}
        <Link href="/kvkk" className="text-link">
          aydınlatma metnini
        </Link>{' '}
        kabul etmiş olursunuz.
      </p>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField id="name" label="Ad soyad" autoComplete="name" placeholder="Ayşe Yılmaz…" error={errors.name} />
          <TextField id="businessName" label="İşletme adı" autoComplete="organization" placeholder="Liman Lokantası…" error={errors.businessName} />
          <TextField id="email" label="E-posta" type="email" inputMode="email" spellCheck={false} autoComplete="email" placeholder="ayse@ornek.com…" />
          <TextField id="phone" label="Telefon (isteğe bağlı)" type="tel" inputMode="tel" autoComplete="tel" placeholder="0532 000 00 00…" error={errors.phone} />
        </div>
        <TextField id="password" label="Şifre (en az 8 karakter)" type="password" autoComplete="new-password" />

        <div className="flex flex-col gap-1">
          <label htmlFor="consent" className="flex min-h-12 cursor-pointer items-start gap-3 text-sm text-ink-soft">
            <input id="consent" name="consent" type="checkbox" aria-invalid={Boolean(errors.consent)} className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--print)]" />
            <span>
              <Link href="/kullanim-sartlari" className="text-link">
                Kullanım şartlarını
              </Link>{' '}
              ve{' '}
              <Link href="/kvkk" className="text-link">
                aydınlatma metnini
              </Link>{' '}
              okudum. Bilgilerimin hesabım için işlenmesini ve hizmet sağlayıcıların yurt dışındaki sunucularına aktarılmasını kabul ediyorum.
            </span>
          </label>
          {errors.consent && <p className="text-sm font-medium text-serial">{errors.consent}</p>}
        </div>

        <FormError message={formError} />

        <button type="submit" className="btn" disabled={isBusy}>
          {isBusy ? 'Gönderiliyor…' : 'Kayıt Ol'}
        </button>
      </form>

      <p className="text-sm text-ink-soft">
        Hesabınız var mı?{' '}
        <Link href="/giris" className="text-link">
          Giriş yapın
        </Link>
      </p>
    </div>
  );
}
