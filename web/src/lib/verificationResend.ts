import { useEffect, useState } from 'react';
import { authPost } from './authApi';

// Doğrulama postası en fazla iki dakikada bir gönderilir: kullanıcı tekrar tekrar giriş
// denediğinde gelen kutusu dolmaz ve sunucunun gönderim sınırına takılmaz.
export const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

const key = (email: string) => `kasam-verify-sent:${email.trim().toLowerCase()}`;

export function lastSentAt(email: string): number {
  try {
    const value = Number(window.localStorage.getItem(key(email)));
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

export function markSent(email: string) {
  try { window.localStorage.setItem(key(email), String(Date.now())); } catch { /* Depolama kapalıysa sayaç yalnız bu sayfada kalır. */ }
}

export async function sendVerificationMail(email: string) {
  const result = await authPost('/send-verification-email', { email: email.trim(), callbackURL: '/hesabim?dogrulandi=1' });
  if (result.ok) markSent(email);
  return result;
}

/** Son gönderimden bu yana iki dakika geçmediyse kalan saniye; geçtiyse 0. */
export function useResendCountdown(email: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const sent = email ? lastSentAt(email) : 0;
  return Math.max(0, Math.ceil((sent + RESEND_COOLDOWN_MS - now) / 1000));
}

export const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
