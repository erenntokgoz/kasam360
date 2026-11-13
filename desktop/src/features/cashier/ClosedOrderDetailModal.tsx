import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';
import { ErrorToast } from '../../ui/ErrorToast';
import { Modal } from '../../ui/Modal';
import { methodSummary, type ClosedOrderDetail } from './closedOrdersModel';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Nakit', CARD: 'Kredi kartı', CREDIT_CARD: 'Kredi kartı', MEAL_CARD: 'Yemek kartı', SPLIT: 'Parçalı', DEBT: 'Veresiye', VERESIYE: 'Veresiye',
};

/** Kapanmış adisyonun kalem, tahsilat, iade ve iptal dökümü; fiş mevcut yazdırma yoluyla yeniden basılır. */
export const ClosedOrderDetailModal: React.FC<{ orderId: string; onClose: () => void }> = ({ orderId, onClose }) => {
  const [detail, setDetail] = useState<ClosedOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<ClosedOrderDetail>('get_closed_order_detail', { actorRole, tenantId, orderId })
      .then((next) => { if (current) setDetail(next); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [orderId]);

  const reprint = async (transactionId: string) => {
    setPrinting(transactionId);
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      await invokeIPC('print_receipt', { receiptId: transactionId, actorRole, tenantId });
      window.print();
      useUIStore.getState().showNotice('Fiş yazdırıldı.');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPrinting(null);
    }
  };

  const header = detail?.header;
  return (
    <Modal cardFlow isOpen title={header ? header.tableName : 'Adisyon'} subtitle={header ? `${formatDateTime(header.openedAt)} - ${formatDateTime(header.closedAt)}` : undefined} maxWidth="lg" onClose={onClose}>
      {!detail && !error ? <p role="status">Adisyon yükleniyor.</p> : null}
      {error ? <ErrorToast message={error} /> : null}
      {detail && header ? (
        <div className="space-y-4">
          <div className="receipt-paper space-y-3 text-sm">
            <p className="tabular-nums text-[var(--text-secondary)]">
              Açan: {header.openedByName ?? '—'} · Kapatan: {header.closedByName ?? '—'} · {header.guestCount} kişi
            </p>
            {detail.items.length === 0 ? <p>Bu adisyonda kalem kaydı yok.</p> : (
              <ul className="divide-y divide-[var(--border)]">
                {detail.items.map((item, index) => (
                  <li key={`${item.productName}-${index}`} className={`flex justify-between gap-3 py-2 ${item.voided ? 'line-through opacity-60' : ''}`}>
                    <span>{item.quantity} × {item.productName}{item.isComp ? ' (ikram)' : ''}{item.voided ? ' (iptal)' : ''}</span>
                    <span className="tabular-nums">{formatMoney(item.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 border-t border-dashed border-[var(--border-strong)] pt-2 tabular-nums">
              <div className="flex justify-between"><dt>Adisyon tutarı</dt><dd>{formatMoney(header.orderTotalCents)}</dd></div>
              <div className="flex justify-between font-bold"><dt>Tahsil edilen ({methodSummary(header)})</dt><dd>{formatMoney(header.paidCents)}</dd></div>
            </dl>
          </div>

          <section aria-label="Tahsilatlar" className="space-y-2">
            <h3 className="text-sm font-bold">Tahsilatlar</h3>
            <ul className="grid gap-2">
              {detail.payments.map((payment) => (
                <li key={payment.transactionId} className="work-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                  <span className="text-sm">
                    <span className="font-semibold">{METHOD_LABEL[payment.method] ?? payment.method}</span>
                    <span className="block text-xs tabular-nums text-[var(--text-secondary)]">{formatDateTime(payment.paidAt)} · {payment.actorName ?? '—'}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold tabular-nums">{formatMoney(payment.amountCents)}</span>
                    <Button size="sm" isLoading={printing === payment.transactionId} disabled={printing !== null} onClick={() => void reprint(payment.transactionId)}>
                      <Printer size={16} aria-hidden="true" />Fişi Yazdır
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {detail.refunds.length > 0 ? (
            <section aria-label="İadeler" className="space-y-2">
              <h3 className="text-sm font-bold">İadeler</h3>
              <ul className="grid gap-1 text-sm">
                {detail.refunds.map((refund) => (
                  <li key={`${refund.createdAt}-${refund.amountCents}`} className="flex justify-between gap-3">
                    <span>{formatDateTime(refund.createdAt)} · {refund.actorName ?? '—'} · {refund.reason}</span>
                    <span className="font-bold tabular-nums text-[var(--accent-red)]">{formatMoney(refund.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.voids.length > 0 ? (
            <section aria-label="İptaller" className="space-y-2">
              <h3 className="text-sm font-bold">İptaller</h3>
              <ul className="grid gap-1 text-sm">
                {detail.voids.map((entry) => (
                  <li key={`${entry.createdAt}-${entry.kind}-${entry.amountCents}`} className="flex justify-between gap-3">
                    <span>{entry.kind === 'ORDER' ? 'Adisyon iptali' : 'Kalem iptali'} · {formatDateTime(entry.createdAt)} · {entry.actorName ?? '—'}{entry.reason ? ` · ${entry.reason}` : ''}</span>
                    <span className="font-bold tabular-nums">{formatMoney(entry.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
};
