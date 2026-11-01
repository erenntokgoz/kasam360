'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent, type HTMLAttributes } from 'react';
import { siteConfig } from '@/content/siteConfig';

type LeadField = 'name' | 'business' | 'email' | 'phone' | 'message' | 'consent';
type LeadErrors = Partial<Record<LeadField, string>>;
type Status = 'idle' | 'sending' | 'sent';

const FIELD_ORDER: LeadField[] = ['name', 'business', 'email', 'phone', 'message', 'consent'];

interface TextFieldProps {
  id: LeadField;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  spellCheck?: boolean;
  error?: string;
}

function TextField({ id, label, type = 'text', error, ...input }: TextFieldProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className="printed">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
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

export function EarlyAccessForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<LeadErrors>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setErrors({});
    setStatus('sending');

    const data = new FormData(event.currentTarget);
    const payload = {
      name: data.get('name'),
      business: data.get('business'),
      email: data.get('email'),
      phone: data.get('phone'),
      message: data.get('message'),
      website: data.get('website'),
      consent: data.get('consent') === 'on',
    };

    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        setStatus('sent');
        return;
      }
      const body = (await response.json()) as { error?: string; errors?: LeadErrors };
      const fieldErrors = body.errors ?? {};
      setErrors(fieldErrors);
      setFormError(body.error ?? '');
      const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field]);
      if (firstInvalid) formRef.current?.querySelector<HTMLElement>(`#${firstInvalid}`)?.focus();
    } catch {
      setFormError(`Talep gönderilemedi. Bağlantınızı kontrol edin veya ${siteConfig.contactEmail} adresine yazın.`);
    }
    setStatus('idle');
  };

  if (status === 'sent') {
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="rubber-stamp self-start text-2xl">LİSTEYE YAZILDI</p>
        <p className="text-ink-soft">Erken erişim başlayınca verdiğiniz e-posta adresine yazacağız.</p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="relative flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="name" label="Ad soyad" autoComplete="name" placeholder="Ayşe Yılmaz…" error={errors.name} />
        <TextField id="business" label="İşletme adı" autoComplete="organization" placeholder="Liman Lokantası…" error={errors.business} />
        <TextField
          id="email"
          label="E-posta"
          type="email"
          inputMode="email"
          spellCheck={false}
          autoComplete="email"
          placeholder="ayse@ornek.com…"
          error={errors.email}
        />
        <TextField
          id="phone"
          label="Telefon (isteğe bağlı)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0532 000 00 00…"
          error={errors.phone}
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="message" className="printed">
          Not (isteğe bağlı)
        </label>
        <textarea id="message" name="message" rows={2} maxLength={1000} placeholder="Masa ve cihaz sayınız…" className="field resize-y" />
        {errors.message && <p className="pt-1 text-sm font-medium text-serial">{errors.message}</p>}
      </div>

      {/* Tuzak alanı: ekran dışındadır, yalnız otomatik gönderen botlar doldurur. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="website">Web sitesi</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="consent" className="flex min-h-12 cursor-pointer items-start gap-3 text-sm text-ink-soft">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            aria-invalid={Boolean(errors.consent)}
            className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--print)]"
          />
          <span>
            <Link href="/kvkk" className="text-link">
              Aydınlatma metnini
            </Link>{' '}
            okudum. Bilgilerimin bu talep için işlenmesini ve hizmet sağlayıcıların yurt dışındaki sunucularına
            aktarılmasını kabul ediyorum.
          </span>
        </label>
        {errors.consent && <p className="text-sm font-medium text-serial">{errors.consent}</p>}
      </div>

      {formError && (
        <p className="break-words font-medium text-serial" role="alert">
          {formError}
        </p>
      )}

      <div>
        <button type="submit" className="btn" disabled={status === 'sending'}>
          {status === 'sending' ? 'Gönderiliyor…' : 'Listeye Yazıl'}
        </button>
      </div>
    </form>
  );
}
