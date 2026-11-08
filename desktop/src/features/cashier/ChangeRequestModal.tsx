import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

export interface ChangeRequestModalProps {
  orderId: string;
  receiptLabel: string;
  onSubmitted: () => void;
  onClose: () => void;
}

/** Kapanmış adisyon değişmez: gerekçeli talep açılır, müdür kuyruğuna düşer. */
export const ChangeRequestModal: React.FC<ChangeRequestModalProps> = ({ orderId, receiptLabel, onSubmitted, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const submit = async () => {
    const description = reason.trim();
    if (isSending || !description) return;
    setIsSending(true);
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('create_order_change_request', { orderId, reason: description, actorId, actorRole, tenantId });
      onSubmitted();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal cardFlow isOpen onClose={() => { if (!isSending) onClose(); }} title="Değişiklik Talebi" subtitle={receiptLabel} maxWidth="md">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="change-reason" className="block text-sm font-semibold text-[var(--text-secondary)]">
          Gerekçe
        </label>
        <textarea
          id="change-reason"
          rows={3}
          maxLength={500}
          disabled={isSending}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full min-h-24 p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--text-primary)]"
        />
        {error ? <ErrorToast message={error} /> : null}
        <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" disabled={isSending} onClick={onClose}>Fişe Dön</Button>
          <Button type="submit" variant="primary" disabled={reason.trim() === ''} isLoading={isSending}>
            Talep Gönder
          </Button>
        </div>
      </form>
    </Modal>
  );
};
