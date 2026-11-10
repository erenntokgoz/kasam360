import { X } from 'lucide-react';
import { planUpdateNotice } from '../../lib/appUpdate';
import { useAuthStore } from '../../stores/authStore';
import { useShiftStore } from '../../stores/shiftStore';
import { useUpdateStore } from '../../stores/updateStore';
import { Button } from '../../ui/Button';

/** Yeni sürüm bildirimi: kapatılabilir, kendiliğinden kurulmaz. Yalnız kurabilen roller görür. */
export function UpdateNotice() {
  const role = useAuthStore((state) => state.user?.role);
  const check = useUpdateStore((state) => state.check);
  const dismissedVersion = useUpdateStore((state) => state.dismissedVersion);
  const installing = useUpdateStore((state) => state.installing);
  const installError = useUpdateStore((state) => state.installError);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);
  const hasOpenShift = useShiftStore((state) => state.activeShift?.isOpen === true);

  if (role !== 'OWNER' && role !== 'MANAGER') return null;
  const notice = planUpdateNotice(check, { hasOpenShift }, dismissedVersion);
  if (notice.kind === 'none') return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm">
      <span className="font-semibold">Güncelleme hazır: {notice.version}</span>
      {notice.blockedReason ? <span className="text-[var(--text-secondary)]">{notice.blockedReason}</span> : null}
      {installError ? <span role="alert" className="text-[var(--danger)]">{installError}</span> : null}
      <span className="ml-auto flex items-center gap-2">
        <Button disabled={!notice.canInstall || installing} onClick={() => void install()}>
          {installing ? 'Kuruluyor…' : 'İndir ve Kur'}
        </Button>
        <button type="button" aria-label="Bildirimi kapat" disabled={installing} onClick={dismiss}
          className="tactile-btn inline-flex h-12 w-12 items-center justify-center rounded-lg">
          <X size={18} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
