'use client';

import { useState } from 'react';
import { formatCountdown, sendVerificationMail, useResendCountdown } from '@/lib/verificationResend';

// Doğrulanmamış hesap uyarısı tek başına çıkmaz bir sokaktı; kullanıcı buradan yeni bağlantı ister.
export function ResendVerification({ email }: { email: string }) {
  const remaining = useResendCountdown(email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const resend = async () => {
    setBusy(true); setMessage(''); setFailed(false);
    const result = await sendVerificationMail(email);
    setBusy(false);
    setFailed(!result.ok);
    setMessage(result.ok ? `${email.trim()} adresine yeni doğrulama bağlantısı gönderildi.` : (result.error ?? 'Gönderilemedi.'));
  };

  return (
    <div className="k-stack" style={{ gap: 8 }}>
      <button type="button" className="k-btn k-btn-line k-btn-block" disabled={busy || remaining > 0 || !validEmail}
        onClick={() => void resend()} aria-describedby="resend-hint">
        {busy ? 'Gönderiliyor…' : remaining > 0
          ? <>Tekrar gönder <span className="tabular-nums">({formatCountdown(remaining)})</span></>
          : 'Doğrulama e-postasını tekrar gönder'}
      </button>
      <p id="resend-hint" className="k-field-hint" style={{ margin: 0 }}>
        {validEmail ? 'Gelen kutusunda yoksa spam klasörüne de bakın.' : 'Önce yukarıya e-posta adresinizi yazın.'}
      </p>
      {message && <p className={failed ? 'k-alert' : 'k-notice'} role={failed ? 'alert' : 'status'} style={{ margin: 0 }}>{message}</p>}
    </div>
  );
}
