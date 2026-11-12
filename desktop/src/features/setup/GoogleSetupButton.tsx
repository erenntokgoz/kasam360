import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useRef, useState } from 'react';
import { readDesktopLink, type WebAccount } from '../../lib/webAccount';
import { Button } from '../../ui/Button';
import { closeGoogleLogin, openSitePage } from '../../lib/googleLogin';

const POLL_MS = 2000;
const POLL_LIMIT = 150;

/** Google girişi tarayıcıda olur; uygulama tek kullanımlık kodla sonucu bekler. */
export const GoogleSetupButton: React.FC<{ onAccount: (account: WebAccount) => void }> = ({ onAccount }) => {
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  const stop = () => {
    window.clearInterval(timer.current);
    void closeGoogleLogin();
    setIsWaiting(false);
  };

  const start = async () => {
    setError(null);
    const code = crypto.randomUUID();
    try {
      await openSitePage(`/api/desktop-link/${code}/google`);
    } catch {
      setError('Tarayıcı açılamadı.');
      return;
    }
    setIsWaiting(true);
    let polls = 0;
    timer.current = window.setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) {
        stop();
        setError('Süre doldu. Yeniden deneyin.');
        return;
      }
      void readDesktopLink(code).then((account) => {
        if (!account) return;
        stop();
        onAccount(account);
      });
    }, POLL_MS);
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <ErrorToast message={error} />
      ) : null}
      <Button type="button" variant="secondary" className="w-full min-h-12" onClick={() => (isWaiting ? stop() : void start())}>
        {isWaiting ? 'Tarayıcıda giriş bekleniyor, iptal et' : 'Google ile Devam Et'}
      </Button>
    </div>
  );
};
