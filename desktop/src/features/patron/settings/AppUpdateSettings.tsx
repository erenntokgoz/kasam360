import { useEffect } from 'react';
import { planUpdateNotice } from '../../../lib/appUpdate';
import { useAuthStore } from '../../../stores/authStore';
import { useShiftStore } from '../../../stores/shiftStore';
import { useUpdateStore } from '../../../stores/updateStore';
import { Button } from '../../../ui/Button';

/** Mevcut sürüm ve elle güncelleme denetimi. Kurulum onay ister; vardiya açıkken yapılmaz. */
export function AppUpdateSettings() {
  const role = useAuthStore((state) => state.user?.role);
  const { currentVersion, check, checking, installing, message, installError, loadVersion, checkManually, install } = useUpdateStore();
  const hasOpenShift = useShiftStore((state) => state.activeShift?.isOpen === true);

  useEffect(() => { void loadVersion(); }, [loadVersion]);

  const canInstallRole = role === 'OWNER' || role === 'MANAGER';
  const notice = planUpdateNotice(check, { hasOpenShift }, null);

  return (
    <section className="work-surface rounded-lg border border-[var(--border)] p-4 space-y-3" aria-labelledby="app-update-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="app-update-heading" className="text-base font-semibold">Uygulama Sürümü</h2>
        <Button disabled={checking || installing} onClick={() => void checkManually()}>
          {checking ? 'Denetleniyor…' : 'Güncellemeleri Denetle'}
        </Button>
      </header>
      <p className="text-sm tabular-nums">Kurulu sürüm: <strong>{currentVersion ?? __APP_VERSION__}</strong></p>
      {message ? <p role="status" className="text-sm text-[var(--text-secondary)]">{message}</p> : null}
      {installError ? <p role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{installError}</p> : null}
      {notice.kind === 'ready' && canInstallRole ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!notice.canInstall || installing} onClick={() => void install()}>
            {installing ? 'Kuruluyor…' : `${notice.version} sürümünü indir ve kur`}
          </Button>
          {notice.blockedReason ? <span className="text-sm text-[var(--text-secondary)]">{notice.blockedReason}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
