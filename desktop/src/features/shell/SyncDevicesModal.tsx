import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { SYNC_STATE_LABEL, useSyncStore } from '../../stores/syncStore';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

interface SyncDevicesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncDevicesModal: React.FC<SyncDevicesModalProps> = ({ isOpen, onClose }) => {
  const { status, createPairingCode, setDevicePassive } = useSyncStore();
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [deviceName, setDeviceName] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const members = status?.members ?? [];
  const isAuthority = members.some((member) => member.isLocal && member.isAuthority);
  const canPair = isOwner && (status?.mode === 'SINGLE' || isAuthority);
  const nameReady = deviceName.trim().length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cihazlar" maxWidth="md">
      <div className="space-y-4">
        {status?.detail ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {status.detail}
          </p>
        ) : null}

        {status?.mode === 'CLUSTER' ? (
          <section>
            <p className="text-xs text-[var(--text-secondary)] mb-2">
              Durum: <strong>{SYNC_STATE_LABEL[status.state]}</strong> · Son onaylı konum{' '}
              <span className="tabular-nums">{status.commitIndex}</span>
            </p>
            <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
              {members.map((member) => (
                <li key={member.deviceId} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--text-primary)] truncate">
                      {member.name}
                      {member.isLocal ? ' (bu cihaz)' : ''}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {member.lastSeen ? `Son görülme ${formatDateTime(member.lastSeen)}` : 'Görülmedi'}
                      {member.acknowledgedIndex != null ? ` · Son eşitlenen ${member.acknowledgedIndex}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.isAuthority ? <Badge variant="blue">Otorite</Badge> : null}
                    {member.isLocal ? null : (
                      <Badge variant={member.connected ? 'emerald' : 'red'}>
                        {member.connected ? 'Bağlı' : 'Kopuk'}
                      </Badge>
                    )}
                    {isOwner && isAuthority && !member.isLocal ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void run(() => setDevicePassive(member.deviceId))}
                        className="min-h-12"
                      >
                        Pasife Al
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isOwner && (canPair || status?.mode === 'SINGLE') ? (
          <section className="space-y-2">
            <p className="text-xs p-3 rounded-lg bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border border-[var(--accent-amber-border)]">
              İki cihaz eşleşince satış, kasa ve vardiya yazmaları durur: bu işlemler henüz
              eşitlenmiyor. Üretim kullanımı için hazır değildir.
            </p>
            <div>
              <label htmlFor="sync-device-name" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Cihaz Adı
              </label>
              <Input
                id="sync-device-name"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </div>
            {canPair ? (
              <Button
                variant="primary"
                disabled={isBusy || !nameReady}
                onClick={() =>
                  void run(async () => {
                    setPairing(await createPairingCode(deviceName.trim()));
                  })
                }
                className="w-full min-h-12"
              >
                Eşleştirme Kodu Üret
              </Button>
            ) : null}
            {pairing ? (
              <p className="text-xs break-all tabular-nums p-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)]">
                {pairing.code}
                <span className="block text-[11px] text-[var(--text-muted)] mt-1">
                  Tek kullanımlık. Geçerlilik: {formatDateTime(`${pairing.expiresAt}Z`)}
                </span>
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
