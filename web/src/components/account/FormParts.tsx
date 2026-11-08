'use client';

import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type FormHTMLAttributes, type InputHTMLAttributes, type Ref } from 'react';
import { authPost } from '@/lib/authApi';

const FormReadyContext = createContext(false);

interface SecureFormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'method' | 'action'> {
  fallbackPath: string;
  ref?: Ref<HTMLFormElement>;
}

// Parola taşıyan formlar sayfa kodu yüklenmeden gönderilemez. Tarayıcının varsayılanı GET olduğu için
// JavaScript kapalı ya da gecikmişken gönderim parolayı adres satırına, geçmişe ve sunucu kayıtlarına yazardı.
// Gönder düğmesi kod çalışana kadar kapalı durur; kapalı varsayılan düğme Enter ile örtük gönderimi de engeller.
// Yine de bir yol bulunursa method="post" parolayı gövdede tutar ve adres sorgusuz sabit sayfadır.
export function SecureForm({ fallbackPath, children, ...form }: SecureFormProps) {
  const [isReady, setIsReady] = useState(false);
  useEffect(() => setIsReady(true), []);
  return (
    <form method="post" action={fallbackPath} {...form}>
      <noscript>
        <p className="k-alert">Bu form JavaScript ile çalışır. Tarayıcınızda JavaScript&apos;i açıp sayfayı yenileyin.</p>
      </noscript>
      <FormReadyContext.Provider value={isReady}>{children}</FormReadyContext.Provider>
    </form>
  );
}

export function SubmitButton({ disabled, ...button }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const isReady = useContext(FormReadyContext);
  return <button type="submit" disabled={!isReady || disabled} {...button} />;
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

// Etiket her zaman görünür; açıklama ve hata alanın altında durur ve ekran okuyucuya alanla birlikte okunur.
export function TextField({ id, label, error, hint, ...input }: TextFieldProps) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="k-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="k-input" {...input} />
      {hint && (
        <p id={`${id}-hint`} className="k-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="k-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="k-alert" role="alert">
      {message}
    </p>
  );
}

export function GoogleButton({ onError }: { onError: (message: string) => void }) {
  const start = async () => {
    const result = await authPost<{ url: string }>('/sign-in/social', {
      provider: 'google',
      callbackURL: '/hesabim',
      errorCallbackURL: '/giris',
    });
    if (result.data?.url) window.location.assign(result.data.url);
    else onError(result.error ?? 'Google ile giriş başlatılamadı.');
  };

  return (
    <button type="button" className="k-btn k-btn-line k-btn-block k-btn-lg" onClick={() => void start()}>
      Google ile devam et
    </button>
  );
}
