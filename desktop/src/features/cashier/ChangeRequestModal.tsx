import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export interface ChangeRequestModalProps {
  orderId: string;
  onClose: () => void;
}

/** Kapanmış adisyon değişmez: gerekçeli talep açılır, müdür kuyruğuna düşer. */
export const ChangeRequestModal: React.FC<ChangeRequestModalProps> = ({ orderId, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const submit = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setIsSending(true);
    try {
      await invokeIPC('create_order_change_request', { orderId, reason, actorId, actorRole, tenantId });
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Değişiklik Talebi" subtitle="Müdür onayından sonra iade akışından düzeltilir." maxWidth="md">
      <div className="space-y-3">
        <label htmlFor="change-reason" className="block text-sm font-semibold text-[var(--text-secondary)]">
          Gerekçe
        </label>
        <textarea
          id="change-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full min-h-24 p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--text-primary)]"
        />
        {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" size="lg" disabled={reason.trim() === ''} isLoading={isSending} onClick={() => void submit()}>
            Talep Gönder
          </Button>
        </div>
      </div>
    </Modal>
  );
};
