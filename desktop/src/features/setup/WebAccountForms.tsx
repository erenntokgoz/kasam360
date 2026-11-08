import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { accountPost, type AccountFieldErrors } from '../../lib/webAccount';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { openSitePage } from '../auth/AccountLogin';
import { formatCountdown, markSent, useResendCountdown } from '../../lib/verificationResend';

const CODE_PATTERN = /^\d{6}$/;

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

const Field: React.FC<FieldProps> = ({ id, label, error, ...input }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium mb-1 text-[var(--text-secondary)]">
      {label}
    </label>
    <Input id={id} className="min-h-12" aria-invalid={Boolean(error)} {...input} aria-describedby={[input['aria-describedby'], error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined} />
    {error ? <p id={`${id}-error`} className="mt-1 text-sm font-medium text-[var(--accent-red)]">{error}</p> : null}
  </div>
);

const FormAlert: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <ErrorToast message={message} />
  ) : null;

export async function sendEmailCode(email: string) {
  const result = await accountPost('/email-otp/send-verification-otp', { email, type: 'email-verification' });
  if (result.ok) markSent(email);
  return result;
}

interface RegisterFormProps {
  onRegistered: (email: string, password: string) => void;
  onBack: () => void;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ onRegistered, onBack }) => {
  const [errors, setErrors] = useState<AccountFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email'));
    const password = String(data.get('password'));
    setErrors({});
    setFormError(null);
    setIsBusy(true);
    const registered = await accountPost('/sign-up/email', {
      name: data.get('name'),
      businessName: data.get('businessName'),
      phone: data.get('phone'),
      email,
      password,
      consent: data.get('consent') === 'on',
    });
    const sent = registered.ok ? await sendEmailCode(email) : registered;
    setIsBusy(false);
    if (sent.ok) {
      onRegistered(email, password);
      return;
    }
    setErrors(sent.errors ?? {});
    setFormError(sent.error ?? null);
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="register-name" name="name" label="Ad soyad" autoComplete="name" autoFocus error={errors.name} />
        <Field id="register-business" name="businessName" label="İşletme adı" autoComplete="organization" error={errors.businessName} />
        <Field id="register-email" name="email" label="E-posta" type="email" autoComplete="email" />
        <Field id="register-phone" name="phone" label="Telefon (isteğe bağlı)" type="tel" autoComplete="tel" error={errors.phone} />
      </div>
      <Field id="register-password" name="password" label="Şifre (en az 8 karakter)" type="password" autoComplete="new-password" />
      <label className="flex min-h-12 items-start gap-3 text-sm text-[var(--text-secondary)]">
        <input name="consent" type="checkbox" className="mt-0.5" />
        <span>
          <button type="button" className="underline font-medium" onClick={() => void openSitePage('/kullanim-sartlari')}>
            Kullanım şartlarını
          </button>{' '}
          ve{' '}
          <button type="button" className="underline font-medium" onClick={() => void openSitePage('/kvkk')}>
            aydınlatma metnini
          </button>{' '}
          okudum, kabul ediyorum.
        </span>
      </label>
      <FormAlert message={errors.consent ?? formError} />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={onBack}>
          Geri
        </Button>
        <Button type="submit" variant="primary" className="min-h-12" isLoading={isBusy}>
          Kayıt Ol
        </Button>
      </div>
    </form>
  );
};

interface VerifyCodeFormProps {
  email: string;
  onVerified: () => Promise<void>;
  onBack: () => void;
}

export const VerifyCodeForm: React.FC<VerifyCodeFormProps> = ({ email, onVerified, onBack }) => {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const remaining = useResendCountdown(email);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setIsBusy(true);
    const verified = await accountPost('/email-otp/verify-email', { email, otp: code });
    if (!verified.ok) {
      setIsBusy(false);
      setFormError(verified.error ?? null);
      return;
    }
    await onVerified().catch((caught) => setFormError(caught instanceof Error ? caught.message : String(caught)));
    setIsBusy(false);
  };

  const resend = async () => {
    setFormError(null);
    setIsSending(true);
    const sent = await sendEmailCode(email);
    setIsSending(false);
    if (sent.ok) setNotice('Yeni kod gönderildi.');
    else setFormError(sent.error ?? null);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      
      <Field
        id="verify-code"
        label={`${email} adresine gelen kod`}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
      />
      <FormAlert message={formError} />
      {notice ? <p role="status">{notice}</p> : null}
      <Button type="submit" variant="primary" className="w-full min-h-12" disabled={!CODE_PATTERN.test(code)} isLoading={isBusy}>
        Doğrula
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={onBack}>
          Geri
        </Button>
        <Button type="button" variant="secondary" className="min-h-12" disabled={remaining > 0} isLoading={isSending} onClick={() => void resend()}>
          {remaining > 0 ? <>Tekrar Gönder <span className="tabular-nums">({formatCountdown(remaining)})</span></> : 'Kodu Yeniden Gönder'}
        </Button>
      </div>
    </form>
  );
};

interface ForgotPasswordFormProps {
  onDone: () => void;
  onBack: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({ onDone, onBack }) => {
  const [step, setStep] = useState<'EMAIL' | 'CODE'>('EMAIL');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setIsBusy(true);
    const result =
      step === 'EMAIL'
        ? await accountPost('/email-otp/request-password-reset', { email })
        : await accountPost('/email-otp/reset-password', { email, otp: code, password });
    setIsBusy(false);
    if (!result.ok) setFormError(result.error ?? null);
    else if (step === 'EMAIL') setStep('CODE');
    else onDone();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      {step === 'EMAIL' ? (
        <Field id="forgot-email" label="E-posta" type="email" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} required />
      ) : (
        <>
          
          <Field
            id="forgot-code"
            label={`${email} adresine gelen kod`}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          <Field id="forgot-password" label="Yeni şifre (en az 8 karakter)" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </>
      )}
      <FormAlert message={formError} />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={onBack}>
          Geri
        </Button>
        <Button type="submit" variant="primary" className="min-h-12" disabled={step === 'CODE' && (!CODE_PATTERN.test(code) || password.length < 8)} isLoading={isBusy}>
          {step === 'EMAIL' ? 'Kod Gönder' : 'Şifreyi Değiştir'}
        </Button>
      </div>
    </form>
  );
};
