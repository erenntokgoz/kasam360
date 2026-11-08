import { ErrorToast } from '../../ui/ErrorToast';
import { useUIStore } from '../../stores/uiStore';
import React, { useCallback, useEffect, useState } from 'react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { useFloorStore } from '../../stores/floorStore';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
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
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => localDate(new Date()));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [showRequests, setShowRequests] = useState(false);
  const pageSize = 30;
  const [error, setError] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRow | null>(null);
  const [receiptAction, setReceiptAction] = useState<'CHANGE' | 'REFUND' | null>(null);
  const [requestRevision, setRequestRevision] = useState(0);
  const canDecide = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    return invokeIPC<ReceiptRow[]>('get_receipts', { actorRole, tenantId, limit: pageSize + 1,
      filter: { offset: page * pageSize, search: search.trim() || null, from: from || null, to: to || null },
    });
  }, [from, page, search, to]);

  useEffect(() => {
    let current = true;
    setReceipts(null);
    setError(null);
    void load().then((rows) => { if (current) setReceipts(rows); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [load]);

  const handleRefunded = () => {
    void load().then(setReceipts).catch((caught) => setError(errorText(caught)));
    onRefunded();
  };

  // Sunucu fişe masanın adını yazar; ad bulunamazsa kimlik gelir, kimlik ekranda gösterilmez.
  const tableNames = new Map(tables.map((table) => [table.id, table.tableNumber]));
  const tableLabel = (raw: string) => tableNames.get(raw) ?? (raw && !/^(ord|tbl|txn)_/.test(raw) ? raw : 'Adisyon');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Fiş veya masa ara" className="min-w-40 flex-1"
          value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        <Input type="date" aria-label="Başlangıç tarihi" className="!w-40"
          value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} />
        <Input type="date" aria-label="Bitiş tarihi" className="!w-40"
          value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} />
        {canDecide ? <Button aria-expanded={showRequests} onClick={() => setShowRequests(!showRequests)}>Değişiklik Talepleri</Button> : null}
      </div>
      {canDecide && showRequests ? <OrderChangeRequests key={requestRevision} onRefunded={handleRefunded} /> : null}
      {error ? <><p className="text-sm text-[var(--text-secondary)]">Fişler okunamadı.</p><ErrorToast message={`Fişler okunamadı: ${error}`} /></> : null}
      {!receipts && !error ? <p role="status">Fişler yükleniyor.</p> : null}
      {receipts?.length === 0 ? <p>Bu aralıkta fiş yok.</p> : null}
      {requestRevision > 0 ? <p role="status" className="mb-3 text-sm font-semibold">Değişiklik talebi kaydedildi.</p> : null}
      <ul className="grid gap-2">
        {receipts?.slice(0, pageSize).map((receipt) => {
          return (
            <li key={receipt.transaction_id}>
              <button type="button" className="work-surface w-full min-h-12 flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
                onClick={() => setSelectedReceipt(receipt)}>
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
              </button>
            </li>
          );
        })}
      </ul>
      <nav aria-label="Fiş sayfaları" className="flex items-center gap-2">
        <Button disabled={page === 0 || !receipts} onClick={() => setPage(page - 1)}>Önceki</Button>
        <span className="tabular-nums">{page + 1}. sayfa</span>
        <Button disabled={(receipts?.length ?? 0) <= pageSize} onClick={() => setPage(page + 1)}>Sonraki</Button>
      </nav>
      {selectedReceipt && !receiptAction ? (
        <Modal cardFlow isOpen title="Fiş Ayrıntısı" maxWidth="sm" onClose={() => setSelectedReceipt(null)}>
          <div className="space-y-4">
            <div>
              <p className="font-semibold">{tableLabel(selectedReceipt.table_id)} · {selectedReceipt.payment_method}</p>
              <p className="text-sm tabular-nums text-[var(--text-secondary)]">{selectedReceipt.fiscal_receipt_no ?? selectedReceipt.transaction_id} · {formatDateTime(selectedReceipt.created_at)}</p>
            </div>
            <dl className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 tabular-nums">
              <div className="flex justify-between gap-3"><dt>Tahsilat</dt><dd>{formatMoney(selectedReceipt.total_cents)}</dd></div>
              <div className="flex justify-between gap-3"><dt>İade Edilen</dt><dd>{formatMoney(selectedReceipt.refunded_cents)}</dd></div>
              <div className="flex justify-between gap-3"><dt>İade Edilebilir</dt><dd>{formatMoney(selectedReceipt.total_cents - selectedReceipt.refunded_cents)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {selectedReceipt.order_id ? (
                <Button onClick={() => setReceiptAction('CHANGE')}>Değişiklik İste</Button>
              ) : null}
              <Button variant="primary" disabled={selectedReceipt.refunded_cents >= selectedReceipt.total_cents}
                onClick={() => setReceiptAction('REFUND')}>İade Et</Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {receiptAction === 'CHANGE' && selectedReceipt?.order_id ? (
        <ChangeRequestModal
          orderId={selectedReceipt.order_id}
          receiptLabel={[tableLabel(selectedReceipt.table_id), formatMoney(selectedReceipt.total_cents), formatDateTime(selectedReceipt.created_at)].join(' · ')}
          onClose={() => setReceiptAction(null)}
          onSubmitted={() => {
            setReceiptAction(null);
            setSelectedReceipt(null);
            setRequestRevision((revision) => revision + 1);
            useUIStore.getState().showNotice('Adisyon değişiklik talebi kaydedildi.');
          }}
        />
      ) : null}
      {receiptAction === 'REFUND' && selectedReceipt ? (
        <RefundModal
          target={selectedReceipt}
          onClose={() => setReceiptAction(null)}
          onDone={() => {
            setReceiptAction(null);
            setSelectedReceipt(null);
            handleRefunded();
          }}
        />
      ) : null}
    </>
  );
};
