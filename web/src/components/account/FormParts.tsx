'use client';

import type { InputHTMLAttributes } from 'react';
import { authPost } from '@/lib/authApi';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

export function TextField({ id, label, error, ...input }: TextFieldProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className="printed">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="field"
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="pt-1 text-sm font-medium text-serial">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="break-words font-medium text-serial" role="alert">
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
    <button type="button" className="btn btn-paper w-full border border-print" onClick={() => void start()}>
      Google ile Devam Et
    </button>
  );
}
