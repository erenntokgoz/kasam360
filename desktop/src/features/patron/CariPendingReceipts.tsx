import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { useCariStore } from '../../stores/cariStore';
import { errorText, newOperationId } from '../../lib/cariInput';
import { legacyApproval } from '../../lib/cariLedger';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import type { AwaitingDocument } from '../../types/ledger';

/**
 * Mal kabulü artık borcu kendisi açıyor; bu satırlar yalnız yeni akıştan önce
 * teslim alınıp borcu açılmamış siparişlerdir. Fark girilmeden kabul tutarıyla
 * işlendiği için ayrı onay penceresi gerekmez.
 */
const PendingReceiptRow: React.FC<{ document: AwaitingDocument; showSupplier: boolean; onDone: () => void }> = ({
  document,
  showSupplier,
  onDone,
}) => {
  const { approveDocument } = useCariStore();
  // Sonuç bilinmezse aynı anahtarla yeniden denenir; ikinci borç açılmaz.
  const [operationId] = useState(newOperationId);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const approve = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await approveDocument(legacyApproval(document, operationId));
      onDone();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <li className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <span className="min-w-0">
        <span className="block font-bold text-[var(--text-primary)] truncate">
          {showSupplier ? `${document.supplierName} · ` : ''}Sipariş {document.orderNumber}
        </span>
        <span className="block text-[var(--text-muted)]">Teslim alındı, borcu açılmadı</span>
        {error ? <ErrorToast message={error} /> : null}
      </span>
      <span className="flex items-center gap-3">
        <span className="font-bold tabular-nums text-[var(--text-primary)]">
          {formatMoney(document.receivedTotalCents)}
        </span>
        <Button variant="outline-amber" isLoading={isBusy} onClick={() => void approve()} className="min-h-12">
          Borca İşle
        </Button>
      </span>
    </li>
  );
};

interface CariPendingReceiptsProps {
  documents: AwaitingDocument[];
  /** Kartı olmayan tedarikçide satır tedarikçi adını da taşır. */
  showSupplier?: boolean;
  onDone: () => void;
}

export const CariPendingReceipts: React.FC<CariPendingReceiptsProps> = ({ documents, showSupplier = false, onDone }) => {
  if (documents.length === 0) return null;
  return (
    <ul className="paper border border-[var(--accent-amber-border)] rounded-xl divide-y divide-[var(--border)]">
      {documents.map((document) => (
        <PendingReceiptRow
          key={document.purchaseOrderId}
          document={document}
          showSupplier={showSupplier}
          onDone={onDone}
        />
      ))}
    </ul>
  );
};
