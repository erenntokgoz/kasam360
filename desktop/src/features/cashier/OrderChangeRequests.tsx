import { ErrorToast } from '../../ui/ErrorToast';
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
  const [requests, setRequests] = useState<ChangeRequest[] | null>(null);
  const [receipts, setReceipts] = useState<OrderReceipt[]>([]);
  const [refundJob, setRefundJob] = useState<RefundJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      const open = await invokeIPC<ChangeRequest[]>('list_order_change_requests', { onlyOpen: true, actorRole, tenantId });
      const orderIds = [...new Set(open.filter((request) => request.status === 'APPROVED').map((request) => request.orderId))];
      const linked = await Promise.all(orderIds.map((orderId) =>
        invokeIPC<OrderReceipt[]>('get_receipts', { actorRole, tenantId, limit: 500, filter: { orderId } }),
      ));
      setReceipts(linked.flat());
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

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 mb-4 space-y-2">
      <h2 className="print-title text-lg font-bold">Değişiklik Talepleri</h2>
      {error ? <ErrorToast message={error} /> : null}
      {!error && requests === null ? <p role="status">Talepler yükleniyor.</p> : null}
      {requests?.length === 0 ? <p>Açık değişiklik talebi yok.</p> : null}
      <ul className="grid gap-2">
        {requests?.map((request) => {
          const refundable = receipts.filter(
            (receipt) => receipt.order_id === request.orderId && receipt.total_cents > receipt.refunded_cents,
          );
          return (
            <li key={request.id}>
              <details className="work-surface rounded-lg border border-[var(--border)]">
                <summary className="min-h-12 cursor-pointer px-3 py-2">
                  <span className="font-semibold">{request.requestedByName ?? 'Personel'}</span>
                  <span className="ml-2 text-sm text-[var(--text-secondary)] tabular-nums">
                    {formatDateTime(request.requestedAt)} · {request.status === 'APPROVED' ? 'Onaylandı' : 'Onay Bekliyor'}
                  </span>
                </summary>
                <div className="space-y-3 border-t border-[var(--border)] p-3">
                  <p className="break-words">{request.reason}</p>
                  <div className="flex flex-wrap gap-2">
                    {request.status === 'PENDING' ? (
                      <>
                        <Button onClick={() => void decide(request.id, false)}>Reddet</Button>
                        <Button variant="primary" onClick={() => void decide(request.id, true)}>Onayla</Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={() => void resolve(request.id, false)}>İadesiz Kapat</Button>
                        {refundable.map((receipt) => (
                          <Button key={receipt.transaction_id} variant="primary" onClick={() => setRefundJob({ request, receipt })}>
                            <RotateCcw size={16} aria-hidden="true" />
                            <span className="tabular-nums">
                              İade: {receipt.payment_method} {formatMoney(receipt.total_cents - receipt.refunded_cents)}
                            </span>
                          </Button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </details>
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
