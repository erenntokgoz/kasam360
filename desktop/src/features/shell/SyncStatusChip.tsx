import React, { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { isTauri } from '../../services/tauriClient';
import { SYNC_STATE_LABEL, useSyncStore, type SyncState } from '../../stores/syncStore';

const POLL_MS = 2000;

type Tone = 'ok' | 'warn' | 'danger' | 'info';

const TONE: Record<SyncState, Tone> = {
  READY: 'ok',
  SYNCING: 'info',
  VERIFYING: 'warn',
  NO_CONNECTION: 'danger',
  INTERVENTION: 'danger',
};

/** Üst çubuktaki yuvarlak eşitleme düğmesi; sorun yokken yer kaplamaz. */
export const SyncStatusChip: React.FC = () => {
  const { status, statusError, refresh } = useSyncStore();
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (!isTauri()) return undefined;
    void refresh();
    // Arka plandaki pencere durumu boşuna okumaz.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!isTauri() || status?.mode === 'SINGLE' || status?.state === 'READY') return null;

  let label = 'Eşitleme durumu okunamadı';
  let tone: Tone = 'danger';
  if (status) {
    label = SYNC_STATE_LABEL[status.state];
    tone = TONE[status.state];
  }
  const Icon = status?.state === 'SYNCING' || status?.state === 'VERIFYING' ? RefreshCw : CloudOff;
  const detail = statusError ?? status?.detail ?? null;

  // Ayrıntı yalnız fare ipucundaydı; dokunmatik ekranda okunamıyordu.
  return (
    <div className="top-sync">
      <button
        type="button"
        className="top-round"
        data-tone={tone}
        aria-label={label}
        aria-expanded={showDetail}
        title={label}
        onClick={() => setShowDetail((shown) => !shown)}
      >
        <Icon className="w-5 h-5" aria-hidden />
      </button>
      {showDetail ? (
        <div className="top-popover" role="status">
          <strong>{label}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
      ) : null}
    </div>
  );
};
