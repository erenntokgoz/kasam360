import React from 'react';
import { AlertCircle } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useSyncStore, type SyncState } from '../../stores/syncStore';
import { Button } from '../../ui/Button';

const SYNC_MESSAGE: Partial<Record<SyncState, string>> = {
  SYNCING: 'Cihazlar eşitleniyor. İşlem birkaç saniye gecikebilir.',
  VERIFYING: 'Son işlemin sonucu doğrulanıyor. Aynı işlemi tekrar başlatmayın.',
  NO_CONNECTION: 'Diğer cihazla bağlantı koptu. Sipariş ve tahsilat yazılmıyor; taslak bu cihazda duruyor.',
  INTERVENTION: 'Eşitleme durdu. Sol menüdeki uyarıya dokunun; ayrıntı orada yazar.',
};

/** Bağlantı ve ikinci cihaz durumu işlem ekranında söylenir; üst çubuk gözden kaçar. */
export const OrderStatusBanner: React.FC<{ className?: string }> = ({ className = '' }) => {
  const remoteNotice = usePosStore((state) => state.remoteNotice);
  const dismiss = usePosStore((state) => state.dismissRemoteNotice);
  const status = useSyncStore((state) => state.status);
  const syncMessage = status?.mode === 'CLUSTER' ? SYNC_MESSAGE[status.state] : undefined;

  if (!syncMessage && !remoteNotice) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {syncMessage ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-[var(--accent-red-border)] bg-[var(--accent-red-soft)] p-3 text-xs font-semibold text-[var(--accent-red)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{syncMessage}</span>
        </p>
      ) : null}
      {remoteNotice ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
          <span>{remoteNotice}</span>
          <Button variant="secondary" className="min-h-12" onClick={dismiss}>Tamam</Button>
        </div>
      ) : null}
    </div>
  );
};
