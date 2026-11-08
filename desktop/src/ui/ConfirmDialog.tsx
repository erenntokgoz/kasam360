import React, { useRef, useState } from 'react';
import { errorText } from '../lib/cariInput';
import { Button } from './Button';
import { ErrorToast } from './ErrorToast';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  cardFlow?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Geri alınamayan işlemin tek onayı. Hata pencere içinde kalır, işlem sessizce kaybolmaz. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel = 'Sil', cardFlow, onConfirm, onClose }) => {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const submitting = useRef(false);

  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      submitting.current = false;
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen cardFlow={cardFlow} onClose={() => { if (!submitting.current) onClose(); }} title={title} subtitle={message} maxWidth="sm">
      <div className="space-y-4">
        <ErrorToast message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" disabled={isBusy} onClick={onClose}>Vazgeç</Button>
          <Button variant="danger" size="lg" isLoading={isBusy} onClick={() => void confirm()}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
};
