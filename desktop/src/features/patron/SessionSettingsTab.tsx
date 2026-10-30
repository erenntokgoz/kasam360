import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { useAuthStore } from '../../stores/authStore';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { ApprovalGrantsPanel } from './ApprovalGrantsPanel';
import { BackupPanel } from './BackupPanel';
import { Button } from '../../ui/Button';

const STAFF_IDLE_OPTIONS = [
  { seconds: 120, label: '2 dakika' },
  { seconds: 300, label: '5 dakika' },
  { seconds: 900, label: '15 dakika' },
  { seconds: 0, label: 'Kalıcı oturum' },
];

/** Bu cihazın oturum ayarları. Diğer cihazları etkilemez. */
export const SessionSettingsTab: React.FC = () => {
  const { session, setPolicy, signOut } = useDeviceSessionStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [error, setError] = useState<string | null>(null);

  if (!session) return <p role="alert" className="text-sm text-[var(--accent-red)]">Oturum ayarları okunamadı.</p>;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <section className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">İşletme hesabı</h2>
        <p className="text-xs text-[var(--text-secondary)]">{session.email}</p>
        <label className="flex items-center gap-3 min-h-12 text-sm text-[var(--text-primary)] cursor-pointer">
          <input
            type="checkbox"
            className="w-6 h-6"
            checked={session.keepSignedIn}
            onChange={(event) => void run(() => setPolicy(event.target.checked, session.staffIdleSeconds))}
          />
          <span>Bu cihazda hesabı açık tut</span>
        </label>
        <p className="text-xs text-[var(--text-secondary)]">
          Kapalıyken uygulama her açılışta e-posta ve şifre ister.
        </p>
        <Button variant="secondary" className="min-h-12" onClick={() => void run(signOut)}>
          Bu cihazda hesaptan çık
        </Button>
      </section>

      <section className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Personel oturumu</h2>
        <p className="text-xs text-[var(--text-secondary)]">
          Personel PIN ile girer. Hareketsiz kalınca ekran kilitlenir; kalıcı oturumda kilitlenmez.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {STAFF_IDLE_OPTIONS.map(({ seconds, label }) => (
            <Button
              key={seconds}
              variant={session.staffIdleSeconds === seconds ? 'primary' : 'secondary'}
              className="min-h-12"
              onClick={() => void run(() => setPolicy(session.keepSignedIn, seconds))}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      {isOwner ? <ApprovalGrantsPanel /> : null}
      {isOwner ? <BackupPanel /> : null}

      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
};
