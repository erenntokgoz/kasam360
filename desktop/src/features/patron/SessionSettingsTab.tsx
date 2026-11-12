import { isMotionForced, setMotionForced } from '../../lib/motion';
import { ErrorToast } from '../../ui/ErrorToast';
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
  { seconds: 0, label: 'Elle Kilitle' },
];

const LEAD_OPTIONS = [30, 45, 60, 75, 90, 105, 120].map((minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return { minutes, label: [hours ? `${hours} saat` : '', rest ? `${rest} dakika` : ''].filter(Boolean).join(' ') };
});

/** Oturum, görünüm ve rezervasyon ayarları. */
export const SessionSettingsTab: React.FC<{ reservations?: boolean }> = ({ reservations = false }) => {
  const { session, setPolicy, signOut } = useDeviceSessionStore();
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const canEditLead = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');
  const [leadMinutes, setLeadMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motionForced, setMotionForcedState] = useState(isMotionForced);
  const chooseMotion = (forced: boolean) => { setMotionForced(forced); setMotionForcedState(forced); };

  useEffect(() => {
    if (!reservations) return;
    let active = true;
    invokeIPC<number>('get_reservation_lead', { tenantId: sessionArgs().tenantId })
      .then((minutes) => { if (active) setLeadMinutes(minutes); })
      .catch((caught) => { if (active) setError(errorText(caught)); });
    return () => { active = false; };
  }, [reservations]);

  if (!reservations && !session) return <p role="alert" className="text-sm text-[var(--accent-red)]">Oturum ayarları okunamadı.</p>;

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
    <div className="grid w-full min-w-0 grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {!reservations && session ? <>
      <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Bu Cihazdaki İşletme Hesabı</h2>
        <p className="text-xs text-[var(--text-secondary)]">{session.email}</p>
        <label className="flex items-center gap-3 min-h-12 text-sm text-[var(--text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={session.keepSignedIn}
            onChange={(event) => void run(() => setPolicy(event.target.checked, session.staffIdleSeconds))}
          />
          <span>İşletme hesabını bu cihazda hatırla</span>
        </label>
        <Button variant="secondary" className="min-h-12" onClick={() => void run(signOut)}>
          İşletme Hesabından Çık
        </Button>
        <p className="text-sm text-[var(--text-secondary)]">Çıkışta kasadaki işlemler buluta gönderilir; bulut hepsini aldığını doğrulayınca bu cihazdaki kayıtlar temizlenir. Gitmeyen işlem varsa kasa temizlenmez ve nedeni giriş ekranında kalıcı olarak gösterilir.</p>
      </section>

      <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Personel Ekran Kilidi</h2>
        <p className="text-sm text-[var(--text-secondary)]">İşlem yapılmadığında ekran bu süre sonunda PIN ile kilitlenir.</p>
        <div className="grid grid-cols-2 gap-2">
          {STAFF_IDLE_OPTIONS.map(({ seconds, label }) => (
            <Button
              key={seconds}
              aria-pressed={session.staffIdleSeconds === seconds}
              variant={session.staffIdleSeconds === seconds ? 'selected' : 'secondary'}
              className="min-h-12"
              onClick={() => void run(() => setPolicy(session.keepSignedIn, seconds))}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Görünüm</h2>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tema">
          <Button variant={theme === 'dark' ? 'selected' : 'secondary'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            Koyu Tema
          </Button>
          <Button variant={theme === 'light' ? 'selected' : 'secondary'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            Açık Tema
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Animasyonlar">
          <Button variant={motionForced ? 'secondary' : 'selected'} aria-pressed={!motionForced} onClick={() => chooseMotion(false)}>
            Sistem Ayarı
          </Button>
          <Button variant={motionForced ? 'selected' : 'secondary'} aria-pressed={motionForced} onClick={() => chooseMotion(true)}>
            Animasyon Açık
          </Button>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">Sistem animasyonları kapatmışsa uygulama da kapatır; Animasyon Açık bunu bu uygulama için yok sayar.</p>
      </section>

      </> : null}

      {reservations && canEditLead ? (
        <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Rezervasyon</h2>
          <label className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-primary)]">
            <span>Boş masayı rezervasyon saatinden</span>
            <select
              aria-label="Rezervasyonun salon ekranında görünme süresi"
              className="min-h-12 px-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-sm font-bold tabular-nums"
              value={leadMinutes ?? 60}
              disabled={leadMinutes === null}
              onChange={(event) => void run(() => saveLead(Number(event.target.value)))}
            >
              {LEAD_OPTIONS.map(({ minutes, label }) => (
                <option key={minutes} value={minutes}>{label}</option>
              ))}
            </select>
            <span>önce rezerve olarak göster.</span>
          </label>
        </section>
      ) : null}

      {error ? (
        <ErrorToast message={error} />
      ) : null}
    </div>
  );
};
