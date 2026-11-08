import { useEffect, useState } from 'react';

// Doğrulama kodu en fazla iki dakikada bir gönderilir; tekrar giriş denemesi gelen kutusunu
// doldurmaz, iki dakikadan eski kod girilmemişse giriş sırasında yenisi kendiliğinden gider.
export const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

const key = (email: string) => `kasam-verify-sent:${email.trim().toLowerCase()}`;

export function lastSentAt(email: string): number {
  try {
    const value = Number(window.localStorage.getItem(key(email)));
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

export function markSent(email: string) {
  try { window.localStorage.setItem(key(email), String(Date.now())); } catch { /* Sayaç yalnız bu oturumda kalır. */ }
}

export const shouldAutoResend = (email: string) => Date.now() - lastSentAt(email) > RESEND_COOLDOWN_MS;

export function useResendCountdown(email: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((lastSentAt(email) + RESEND_COOLDOWN_MS - now) / 1000));
}

export const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
