import React, { useEffect, useState } from 'react';
import { useCariStore } from '../../stores/cariStore';
import { localDate, newOperationId, parseCents } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { OperationFeedback, useOperationSubmit } from './CariOperationForm';
import type { AwaitingDocument } from '../../types/ledger';

function dueFromTerm(days: number): string {
  const due = new Date();
  due.setDate(due.getDate() + days);
  return localDate(due);
}

interface ApproveModalProps {
  document: AwaitingDocument | null;
  onClose: () => void;
  onApproved: () => void;
}

const ApproveModal: React.FC<ApproveModalProps> = ({ document, onClose, onApproved }) => {
  const { approveDocument } = useCariStore();
  const [documentNo, setDocumentNo] = useState('');
  const [total, setTotal] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [operationId, setOperationId] = useState(newOperationId);
  const [inputError, setInputError] = useState<string | null>(null);
  const operation = useOperationSubmit(onApproved);

  useEffect(() => {
    if (!document) return;
    setDocumentNo('');
    setTotal(formatMoney(document.receivedTotalCents).replace(' ₺', ''));
    setDueDate(dueFromTerm(document.paymentTermDays));
    setReason('');
    setInputError(null);
    setOperationId(newOperationId());
  }, [document]);

  const totalCents = parseCents(total);
  const differenceCents =
    document && totalCents !== null ? totalCents - document.receivedTotalCents : 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!document) return;
    if (!totalCents) {
      setInputError('Geçerli bir belge tutarı girin.');
      return;
    }
    setInputError(null);
    void operation.run(operationId, () =>
      approveDocument({
        operationId,
        purchaseOrderId: document.purchaseOrderId,
        documentNo: documentNo.trim(),
        documentTotalCents: totalCents,
        dueDate: dueDate || undefined,
        differenceReason: reason.trim() || undefined,
      })
    );
  };

  return (
    <Modal
      isOpen={document !== null}
      onClose={onClose}
      title="Tedarikçi Belgesi Onayı"
      subtitle={document ? `${document.supplierName} · Sipariş ${document.orderNumber}` : undefined}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="doc-no" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
            Belge No
          </label>
          <Input
            id="doc-no"
            value={documentNo}
            onChange={(event) => setDocumentNo(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="doc-total" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Belge Tutarı (₺)
            </label>
            <Input
              id="doc-total"
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              className="tabular-nums min-h-12"
              required
            />
          </div>
          <div>
            <label htmlFor="doc-due" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Vade
            </label>
            <Input
              id="doc-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="tabular-nums min-h-12"
            />
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Kabul tutarı:{' '}
          <span className="tabular-nums font-bold">
            {formatMoney(document?.receivedTotalCents ?? 0)}
          </span>
        </p>
        {differenceCents !== 0 ? (
          <div>
            <label htmlFor="doc-reason" className="block text-xs font-semibold mb-1 text-[var(--accent-amber)]">
              Fark {formatMoney(differenceCents)}: gerekçe zorunlu
            </label>
            <Input
              id="doc-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>
        ) : null}
        {inputError ? (
          <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
            {inputError}
          </p>
        ) : null}
        <OperationFeedback
          error={operation.error}
          pendingOperationId={operation.pendingOperationId}
          isSaving={operation.isSaving}
          onCheck={() => void operation.checkResult()}
        />
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1 min-h-12">
            Kapat
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={operation.isSaving}
            disabled={operation.pendingOperationId !== null}
            className="flex-1 min-h-12"
          >
            Onayla ve Borç Aç
          </Button>
        </div>
      </form>
    </Modal>
  );
};

interface SupplierDocumentsPanelProps {
  onChanged: () => void;
}

export const SupplierDocumentsPanel: React.FC<SupplierDocumentsPanelProps> = ({ onChanged }) => {
  const { awaiting, loadAwaiting } = useCariStore();
  const [selected, setSelected] = useState<AwaitingDocument | null>(null);

  useEffect(() => {
    void loadAwaiting();
  }, [loadAwaiting]);

  if (awaiting.length === 0 && !selected) return null;

  const handleApproved = () => {
    setSelected(null);
    void loadAwaiting();
    onChanged();
  };

  return (
    <section className="bg-[var(--bg-panel)] border border-[var(--accent-amber-border)] rounded-xl overflow-hidden">
      <h4 className="px-4 py-3 border-b border-[var(--border)] text-xs font-bold text-[var(--text-primary)]">
        Belge Bekleniyor
      </h4>
      <ul className="divide-y divide-[var(--border)]">
        {awaiting.map((document) => (
          <li key={document.purchaseOrderId} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <p className="font-bold text-[var(--text-primary)] truncate">{document.supplierName}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sipariş {document.orderNumber}
                {document.directoryId ? '' : ' · Cari kart onayda açılır'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="amber">Borç doğmadı</Badge>
              <span className="font-bold tabular-nums text-[var(--text-primary)]">
                {formatMoney(document.receivedTotalCents)}
              </span>
              <Button variant="outline-amber" onClick={() => setSelected(document)} className="min-h-12">
                Belgeyi İşle
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ApproveModal document={selected} onClose={() => setSelected(null)} onApproved={handleApproved} />
    </section>
  );
};
