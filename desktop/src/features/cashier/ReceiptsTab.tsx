import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useFloorStore } from '../../stores/floorStore';
import { Button } from '../../ui/Button';
import { RefundModal, type RefundTarget } from './RefundModal';

interface ReceiptRow extends RefundTarget {
  created_at: string;
  table_id: string;
  fiscal_receipt_no: string | null;
  payment_method: string;
}

/** Son tahsilatlar. İade fişten başlar: tutar ve kanal kayıtlı tahsilattan gelir. */
export const ReceiptsTab: React.FC<{ onRefunded: () => void }> = ({ onRefunded }) => {
  const tables = useFloorStore((state) => state.tables);
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ReceiptRow | null>(null);

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

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
        Fişler okunamadı: {error}
      </p>
    );
  }
  if (!receipts) return <p className="text-sm text-[var(--text-secondary)]">Fişler yükleniyor…</p>;
  if (receipts.length === 0) return <p className="paper p-6 text-[var(--text-secondary)]">Henüz tahsilat yok.</p>;

  // Kimlik yerine masanın adı görünür; silinmiş masa düz adisyon olarak yazılır.
  const tableNames = new Map(tables.map((table) => [table.id, table.tableNumber]));

  return (
    <>
      <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {receipts.map((receipt) => {
          const remaining = receipt.total_cents - receipt.refunded_cents;
          return (
            <li key={receipt.transaction_id} className="flex items-center gap-3 px-4 py-2 min-h-14">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                  {tableNames.get(receipt.table_id) ?? 'Adisyon'} · {receipt.payment_method}
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
      {target ? (
        <RefundModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            void load();
            onRefunded();
          }}
        />
      ) : null}
    </>
  );
};
