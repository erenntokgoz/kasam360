import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { Button } from '../../ui/Button';
import { openSitePage } from './AccountLogin';

const POLL_MS = 2000;
const POLL_LIMIT = 150;

/**
 * Hesabı Google ile açılmış işletmenin cihaz girişi. Şifresi olmayan sahip oturum
 * düşünce (yedekten dönüş, çıkış) kasaya giremiyordu. Kimliği sunucu doğrular.
 */
export const GoogleDeviceButton: React.FC = () => {
  const signInWithLink = useDeviceSessionStore((state) => state.signInWithLink);
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  const stop = () => {
    window.clearInterval(timer.current);
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
      void signInWithLink(code)
        .then((done) => {
          if (done) stop();
        })
        .catch((caught) => {
          stop();
          setError(errorText(caught));
        });
    }, POLL_MS);
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <ErrorToast message={error} />
      ) : null}
      <Button type="button" variant="secondary" className="w-full min-h-12" onClick={() => (isWaiting ? stop() : void start())}>
        {isWaiting ? 'Tarayıcıda giriş bekleniyor, iptal et' : 'Google ile Giriş Yap'}
      </Button>
    </div>
  );
};
