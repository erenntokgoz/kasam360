import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { useFloorStore } from '../../stores/floorStore';
import { Button } from '../../ui/Button';
import { ChangeRequestModal } from './ChangeRequestModal';
import { OrderChangeRequests } from './OrderChangeRequests';
import { RefundModal, type RefundTarget } from './RefundModal';

interface ReceiptRow extends RefundTarget {
  created_at: string;
  table_id: string;
  fiscal_receipt_no: string | null;
  order_id: string | null;
  payment_method: string;
}

/** Son tahsilatlar. İade fişten başlar: tutar ve kanal kayıtlı tahsilattan gelir. */
export const ReceiptsTab: React.FC<{ onRefunded: () => void }> = ({ onRefunded }) => {
  const tables = useFloorStore((state) => state.tables);
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ReceiptRow | null>(null);
  const [changeReceipt, setChangeReceipt] = useState<ReceiptRow | null>(null);
  const [requestRevision, setRequestRevision] = useState(0);
  const canDecide = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');

  const load = useCallback(async () => {
    try {
      setError(null);
      const { actorRole, tenantId } = sessionArgs();
      setReceipts(await invokeIPC<ReceiptRow[]>('get_receipts', { actorRole, tenantId, limit: 50 }));
    } catch (caught) {
      setReceipts(null);
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefunded = () => {
    void load();
    onRefunded();
  };

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
        Fişler okunamadı: {error}
      </p>
    );
  }
  if (!receipts) return <p className="text-sm text-[var(--text-secondary)]">Fişler yükleniyor…</p>;
  if (receipts.length === 0) {
    return (
      <>
        {canDecide ? <OrderChangeRequests key={requestRevision} onRefunded={handleRefunded} /> : null}
        <p className="paper p-4 text-[var(--text-secondary)]">Henüz tahsilat yok.</p>
      </>
    );
  }

  // Sunucu fişe masanın adını yazar; ad bulunamazsa kimlik gelir, kimlik ekranda gösterilmez.
  const tableNames = new Map(tables.map((table) => [table.id, table.tableNumber]));
  const tableLabel = (raw: string) => tableNames.get(raw) ?? (raw && !/^(ord|tbl|txn)_/.test(raw) ? raw : 'Adisyon');

  return (
    <>
      {canDecide ? <OrderChangeRequests key={requestRevision} onRefunded={handleRefunded} /> : null}
      {requestRevision > 0 ? <p role="status" className="mb-3 text-sm font-semibold">Değişiklik talebi kaydedildi.</p> : null}
      <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {receipts.map((receipt) => {
          const remaining = receipt.total_cents - receipt.refunded_cents;
          return (
            <li key={receipt.transaction_id} className="flex items-center gap-3 px-4 py-2 min-h-12">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                  {tableLabel(receipt.table_id)} · {receipt.payment_method}
                </p>
                <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                  {receipt.fiscal_receipt_no ?? receipt.transaction_id} · {formatDateTime(receipt.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(receipt.total_cents)}
                </p>
                {receipt.refunded_cents > 0 ? (
                  <p className="text-xs font-semibold text-[var(--accent-red)] tabular-nums">
                    İade: {formatMoney(receipt.refunded_cents)}
                  </p>
                ) : null}
              </div>
              {receipt.order_id ? (
                <Button variant="ghost" onClick={() => setChangeReceipt(receipt)}>
                  Değişiklik İste
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="min-h-12"
                disabled={remaining <= 0}
                onClick={() => setTarget(receipt)}
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                <span>İade</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {changeReceipt?.order_id ? (
        <ChangeRequestModal
          orderId={changeReceipt.order_id}
          receiptLabel={[tableLabel(changeReceipt.table_id), formatMoney(changeReceipt.total_cents), formatDateTime(changeReceipt.created_at)].join(' · ')}
          onClose={() => setChangeReceipt(null)}
          onSubmitted={() => {
            setChangeReceipt(null);
            setRequestRevision((revision) => revision + 1);
          }}
        />
      ) : null}
      {target ? (
        <RefundModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            handleRefunded();
          }}
        />
      ) : null}
    </>
  );
};
