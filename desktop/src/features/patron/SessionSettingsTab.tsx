import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';
import { sessionArgs } from '../../stores/cariStore';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';

const STAFF_IDLE_OPTIONS = [
  { seconds: 120, label: '2 dakika' },
  { seconds: 300, label: '5 dakika' },
  { seconds: 900, label: '15 dakika' },
  { seconds: 0, label: 'Kalıcı oturum' },
];

const LEAD_OPTIONS = [30, 45, 60, 75, 90, 105, 120].map((minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return { minutes, label: [hours ? `${hours} saat` : '', rest ? `${rest} dakika` : ''].filter(Boolean).join(' ') };
});

/** Oturum, görünüm ve rezervasyon ayarları. */
export const SessionSettingsTab: React.FC = () => {
  const { session, setPolicy, signOut } = useDeviceSessionStore();
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const canEditLead = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');
  const [leadMinutes, setLeadMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invokeIPC<number>('get_reservation_lead', { tenantId: sessionArgs().tenantId })
      .then(setLeadMinutes)
      .catch((caught) => setError(errorText(caught)));
  }, []);

  if (!session) return <p role="alert" className="text-sm text-[var(--accent-red)]">Oturum ayarları okunamadı.</p>;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const saveLead = async (minutes: number) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('set_reservation_lead', { minutes, actorRole, tenantId });
    setLeadMinutes(minutes);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">İşletme hesabı</h2>
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

      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Personel oturumu</h2>
        <p className="text-xs text-[var(--text-secondary)]">
          Personel PIN ile girer. Hareketsiz kalınca ekran kilitlenir; kalıcı oturumda kilitlenmez.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {STAFF_IDLE_OPTIONS.map(({ seconds, label }) => (
            <Button
              key={seconds}
              variant={session.staffIdleSeconds === seconds ? 'selected' : 'secondary'}
              className="min-h-12"
              onClick={() => void run(() => setPolicy(session.keepSignedIn, seconds))}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Görünüm</h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tema">
          <Button variant={theme === 'dark' ? 'selected' : 'secondary'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            Koyu Tema
          </Button>
          <Button variant={theme === 'light' ? 'selected' : 'secondary'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            Açık Tema
          </Button>
        </div>
      </section>

      {canEditLead ? (
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Rezervasyon</h2>
          <label className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-primary)]">
            <span>Rezerve masaları rezervasyon saatinden</span>
            <select
              aria-label="Masayı kapatma süresi"
              className="min-h-12 px-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-sm font-bold tabular-nums"
              value={leadMinutes ?? 60}
              disabled={leadMinutes === null}
              onChange={(event) => void run(() => saveLead(Number(event.target.value)))}
            >
              {LEAD_OPTIONS.map(({ minutes, label }) => (
                <option key={minutes} value={minutes}>{label}</option>
              ))}
            </select>
            <span>önce kapat.</span>
          </label>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="lg:col-span-2 text-sm font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
    </div>
  );
};
