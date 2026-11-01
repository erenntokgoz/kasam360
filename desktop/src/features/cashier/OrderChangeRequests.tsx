import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { RefundModal, type RefundTarget } from './RefundModal';

interface ChangeRequest {
  id: string;
  orderId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByName: string | null;
  requestedAt: string;
}

interface OrderReceipt extends RefundTarget {
  payment_method: string;
}

interface RefundJob {
  request: ChangeRequest;
  receipt: OrderReceipt;
}

/**
 * Müdürün karar kuyruğu. Onay adisyonu değiştirmez: onaylanan talep burada kalır, parasal
 * düzeltme PIN onaylı iadeyle yapılır ya da talep iadesiz kapatılır.
 */
export const OrderChangeRequests: React.FC<{ onRefunded: () => void }> = ({ onRefunded }) => {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [receipts, setReceipts] = useState<OrderReceipt[]>([]);
  const [refundJob, setRefundJob] = useState<RefundJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      const open = await invokeIPC<ChangeRequest[]>('list_order_change_requests', { onlyOpen: true, actorRole, tenantId });
      // Talep eski bir adisyona ait olabilir; fiş listesinin görünen 50 satırıyla sınırlanmaz.
      const hasApproved = open.some((request) => request.status === 'APPROVED');
      setReceipts(hasApproved ? await invokeIPC<OrderReceipt[]>('get_receipts', { actorRole, tenantId, limit: 500 }) : []);
      setRequests(open);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    try {
      await invokeIPC('decide_order_change_request', { id, approve, note: null, actorId, actorRole, tenantId });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const resolve = async (id: string, refunded: boolean) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    try {
      await invokeIPC('resolve_order_change_request', { id, refunded, actorId, actorRole, tenantId });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  if (!error && requests.length === 0) return null;

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 mb-4 space-y-2">
      <h2 className="print-title text-lg font-bold">Değişiklik Talepleri</h2>
      {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
      <ul className="divide-y divide-[var(--border)]">
        {requests.map((request) => {
          const refundable = receipts.filter(
            (receipt) => receipt.order_id === request.orderId && receipt.total_cents > receipt.refunded_cents,
          );
          return (
            <li key={request.id} className="flex flex-wrap items-center gap-3 py-2 min-h-12">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--text-primary)] break-words">{request.reason}</p>
                <p className="text-sm text-[var(--text-secondary)] tabular-nums">
                  {request.requestedByName ?? 'Personel'} · {formatDateTime(request.requestedAt)}
                  {request.status === 'APPROVED' ? ' · Onaylandı' : ''}
                </p>
              </div>
              {request.status === 'PENDING' ? (
                <>
                  <Button variant="secondary" onClick={() => void decide(request.id, false)}>Reddet</Button>
                  <Button variant="primary" onClick={() => void decide(request.id, true)}>Onayla</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => void resolve(request.id, false)}>İadesiz Kapat</Button>
                  {refundable.map((receipt) => (
                    <Button key={receipt.transaction_id} variant="primary" onClick={() => setRefundJob({ request, receipt })}>
                      <RotateCcw className="w-4 h-4 mr-1" />
                      <span className="tabular-nums">
                        İade: {receipt.payment_method} {formatMoney(receipt.total_cents - receipt.refunded_cents)}
                      </span>
                    </Button>
                  ))}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {refundJob ? (
        <RefundModal
          target={refundJob.receipt}
          initialReason={refundJob.request.reason}
          onClose={() => setRefundJob(null)}
          onDone={() => {
            const { id } = refundJob.request;
            setRefundJob(null);
            onRefunded();
            void resolve(id, true);
          }}
        />
      ) : null}
    </section>
  );
};
