import React, { useState } from 'react';
import { useCariStore } from '../../stores/cariStore';
import { errorCode, errorText } from '../../lib/cariInput';
import { Button } from '../../ui/Button';

interface OperationState {
  error: string | null;
  pendingOperationId: string | null;
  isSaving: boolean;
}

/**
 * Para yazan formların ortak akışı. Sonuç bilinmiyorsa ikinci ödeme
 * gönderilmez; kullanıcı aynı işlem kimliğiyle sonucu sorar.
 */
export function useOperationSubmit(onDone: () => void) {
  const { queryOperation } = useCariStore();
  const [state, setState] = useState<OperationState>({
    error: null,
    pendingOperationId: null,
    isSaving: false,
  });

  const run = async (operationId: string, action: () => Promise<void>) => {
    setState({ error: null, pendingOperationId: null, isSaving: true });
    try {
      await action();
      setState({ error: null, pendingOperationId: null, isSaving: false });
      onDone();
    } catch (caught) {
      const pending = errorCode(caught) === 'PENDING_RESULT';
      setState({
        error: pending ? 'İşlem sonucu doğrulanamadı.' : errorText(caught),
        pendingOperationId: pending ? operationId : null,
        isSaving: false,
      });
    }
  };

  const checkResult = async () => {
    const operationId = state.pendingOperationId;
    if (!operationId) return;
    setState((current) => ({ ...current, isSaving: true }));
    try {
      const outcome = await queryOperation(operationId);
      if (outcome.status === 'APPLIED') {
        setState({ error: null, pendingOperationId: null, isSaving: false });
        onDone();
      } else if (outcome.status === 'REJECTED') {
        setState({
          error: errorText(outcome.error ?? 'İşlem reddedildi.'),
          pendingOperationId: null,
          isSaving: false,
        });
      } else {
        setState({
          error: 'Sonuç henüz doğrulanamadı. Ödemeyi yeniden girmeyin.',
          pendingOperationId: operationId,
          isSaving: false,
        });
      }
    } catch (caught) {
      setState((current) => ({ ...current, error: errorText(caught), isSaving: false }));
    }
  };

  return { ...state, run, checkResult };
}

interface OperationFeedbackProps {
  error: string | null;
  pendingOperationId: string | null;
  isSaving: boolean;
  onCheck: () => void;
}

export const OperationFeedback: React.FC<OperationFeedbackProps> = ({
  error,
  pendingOperationId,
  isSaving,
  onCheck,
}) => {
  if (!error) return null;
  return (
    <div role="alert" className="space-y-2">
      <p className="text-xs font-semibold text-[var(--accent-red)]">{error}</p>
      {pendingOperationId ? (
        <>
          <p className="text-[11px] text-[var(--text-secondary)] break-all">
            İşlem kimliği: <span className="tabular-nums">{pendingOperationId}</span>
          </p>
          <Button
            type="button"
            variant="outline-amber"
            isLoading={isSaving}
            onClick={onCheck}
            className="w-full min-h-12"
          >
            Sonucu Sorgula
          </Button>
        </>
      ) : null}
    </div>
  );
};
