import React, { useState } from 'react';
import { errorText } from '../lib/cariInput';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Geri alınamayan işlemin tek onayı. Hata pencere içinde kalır, işlem sessizce kaybolmaz. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel = 'Sil', onConfirm, onClose }) => {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const confirm = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={title} subtitle={message} maxWidth="sm">
      <div className="space-y-4">
        {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose}>Vazgeç</Button>
          <Button variant="danger" size="lg" isLoading={isBusy} onClick={() => void confirm()}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
};
