import React, { useEffect, useState } from 'react';
import { isTauri } from '../../services/tauriClient';
import { SYNC_STATE_LABEL, useSyncStore, type SyncState } from '../../stores/syncStore';
import { Badge } from '../../ui/Badge';

const POLL_MS = 2000;

const TONE: Record<SyncState, 'emerald' | 'amber' | 'red' | 'blue'> = {
  READY: 'emerald',
  SYNCING: 'blue',
  VERIFYING: 'amber',
  NO_CONNECTION: 'red',
  INTERVENTION: 'red',
};

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

  // Sorun yokken ekranda yer kaplamaz; cihaz durumu Ayarlar'dan görülür.
  if (!isTauri() || status?.mode === 'SINGLE' || status?.state === 'READY') return null;

  let label = 'Eşitleme durumu okunamadı';
  let tone: 'emerald' | 'amber' | 'red' | 'blue' | 'neutral' = 'red';
  if (status) {
    label = SYNC_STATE_LABEL[status.state];
    tone = TONE[status.state];
  }

  const detail = statusError ?? status?.detail ?? null;
  // Ayrıntı yalnız fare ipucundaydı; dokunmatik ekranda okunamıyordu.
  return (
    <div className="w-full px-1 flex flex-col items-center gap-1">
      <button type="button" className="min-h-12 flex items-center justify-center cursor-pointer" onClick={() => setShowDetail((shown) => !shown)}>
        <Badge variant={tone}>{label}</Badge>
      </button>
      {showDetail && detail ? <p className="text-xs text-center break-words text-[var(--text-primary)]">{detail}</p> : null}
    </div>
  );
};
