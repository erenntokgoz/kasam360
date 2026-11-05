import React, { useEffect, useRef, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { useLicenseStore, type LicenseState } from '../../stores/licenseStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { AuthShell } from '../auth/AuthShell';
import { openSitePage } from '../auth/AccountLogin';

const POLL_MS = 2000;
const POLL_LIMIT = 150;

/** Hata satırı; kapı ekranı başka bileşene bağlı kalmasın diye yerel tutulur. */
const Alert: React.FC<{ message: string }> = ({ message }) => (
  <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{message}</p>
);

const STATE_TEXT: Record<LicenseState, string> = {
  MISSING: 'Bu kasa henüz işletme hesabına bağlı değil.',
  ACTIVE: 'Lisans geçerli.',
  GRACE: 'Abonelik süresi doldu; kasa kısa bir süre daha açık kalır.',
  EXPIRED: 'Abonelik süresi doldu. Yenilendikten sonra Yeniden Dene ile devam edin.',
  NO_PACKAGE: 'Hesabınızda etkin paket yok.',
  BLOCKED: 'İşletme hesabı askıya alındı. Destek ile iletişime geçin.',
  INVALID: 'Lisans belgesi bu cihaz için geçerli değil. Cihazı yeniden bağlayın.',
};

/** Google girişi tarayıcıda biter; kasa tek kullanımlık kodla lisans anahtarını bekler. */
const GoogleLinkButton: React.FC<{ onError: (message: string) => void }> = ({ onError }) => {
  const linkWithGoogle = useLicenseStore((state) => state.linkWithGoogle);
  const [isWaiting, setIsWaiting] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  const stop = () => {
    window.clearInterval(timer.current);
    setIsWaiting(false);
  };

  const start = async () => {
    const code = crypto.randomUUID();
    try {
      await openSitePage(`/api/desktop-link/${code}/google`);
    } catch {
      onError('Tarayıcı açılamadı.');
      return;
    }
    setIsWaiting(true);
    let polls = 0;
    timer.current = window.setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) {
        stop();
        onError('Süre doldu. Yeniden deneyin.');
        return;
      }
      void linkWithGoogle(code)
        .then((done) => {
          if (done) stop();
        })
        .catch((caught) => {
          stop();
          onError(errorText(caught));
        });
    }, POLL_MS);
  };

  return (
    <Button type="button" variant="secondary" className="w-full min-h-12" onClick={() => (isWaiting ? stop() : void start())}>
      {isWaiting ? 'Tarayıcıda giriş bekleniyor, iptal et' : 'Google ile Bağla'}
    </Button>
  );
};

/**
 * Lisans yoksa veya geçersizse personel ekranı açılmaz. Bağlamayı işletme sahibi web
 * hesabıyla yapar; şifre kasada saklanmaz, yalnız sunucunun verdiği anahtar saklanır.
 */
export const LicenseGate: React.FC = () => {
  const { status, error: loadError, refresh, link } = useLicenseStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const linked = !!status?.linked;
  const formVisible = !linked || showForm;

  const run = async (task: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await task();
      setPassword('');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const serverNote = status?.lastError ?? loadError;

  return (
    <AuthShell title="Lisans">
      <div className="flex flex-col gap-3">
        <p className="text-sm">{STATE_TEXT[status?.state ?? 'MISSING']}</p>
        {status?.plan ? (
          <p className="text-sm text-[var(--text-secondary)] tabular-nums">
            {status.plan.name}{status.validUntil ? ` · ${status.validUntil} tarihine kadar` : ''}
          </p>
        ) : null}
        {serverNote ? <Alert message={serverNote} /> : null}
        {error ? <Alert message={error} /> : null}

        {linked ? (
          <Button type="button" variant="primary" className="w-full min-h-12" isLoading={isBusy}
            onClick={() => void run(refresh)}>
            Yeniden Dene
          </Button>
        ) : null}

        {formVisible ? (
          <form className="flex flex-col gap-3" onSubmit={(event) => {
            event.preventDefault();
            void run(() => link(email, password));
          }}>
            <label className="block space-y-1"><span className="text-sm font-semibold">İşletme hesabı e-postası</span>
              <Input aria-label="E-posta" type="email" className="min-h-12" required disabled={isBusy}
                value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="block space-y-1"><span className="text-sm font-semibold">Şifre</span>
              <Input aria-label="Şifre" type="password" className="min-h-12" required disabled={isBusy}
                value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <Button type="submit" variant={linked ? 'secondary' : 'primary'} className="w-full min-h-12" isLoading={isBusy}>
              Kasayı Bağla
            </Button>
            <GoogleLinkButton onError={setError} />
          </form>
        ) : (
          <Button type="button" variant="ghost" className="w-full min-h-12" onClick={() => setShowForm(true)}>
            Başka Hesapla Bağla
          </Button>
        )}
      </div>
    </AuthShell>
  );
};
