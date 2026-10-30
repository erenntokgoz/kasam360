import React, { useEffect, useState } from 'react';
import { isTauri } from '../../services/tauriClient';
import { SYNC_STATE_LABEL, useSyncStore, type SyncState } from '../../stores/syncStore';
import { Badge } from '../../ui/Badge';
import { SyncDevicesModal } from './SyncDevicesModal';

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
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return undefined;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!isTauri()) return null;

  let label = 'Eşitleme durumu okunamadı';
  let tone: 'emerald' | 'amber' | 'red' | 'blue' | 'neutral' = 'red';
  if (status?.mode === 'SINGLE') {
    label = 'Tek cihaz';
    tone = 'neutral';
  } else if (status) {
    label = SYNC_STATE_LABEL[status.state];
    tone = TONE[status.state];
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={statusError ?? status?.detail ?? undefined}
        className="cursor-pointer min-h-[36px]"
      >
        <Badge variant={tone}>{label}</Badge>
      </button>
      <SyncDevicesModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};
