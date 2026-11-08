import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { balanceSide, debtLabel, isEditable, lineLabel, purchaseLink } from '../../lib/cariLedger';
import { invokeIPC } from '../../services/tauriClient';
import { formatDay, formatServerDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import type { LedgerDebt, StatementLine } from '../../types/ledger';

interface OrderLine {
  name: string;
  quantity: number;
  totalCents: number;
}

export const COLUMN_COUNT = 7;

/** Bakiye tutarı mutlak, yönü B/A ile yazılır; kart başlığıyla aynı biçim. */
export const BalanceCell: React.FC<{ cents: number }> = ({ cents }) => (
  <span className="tabular-nums whitespace-nowrap">
    {formatMoney(Math.abs(cents))} {balanceSide(cents)}
  </span>
);

export interface DebtActions {
  onPay: (debt: LedgerDebt) => void;
  onEdit: (debt: LedgerDebt) => void;
  onDelete: (debt: LedgerDebt) => void;
}

/** Açık kaydın kalan, vade ve işlem düğmeleri; ekstre satırında ve devreden satırda aynıdır. */
const OpenDebtInfo: React.FC<{ debt: LedgerDebt }> = ({ debt }) => (
  <span className="flex flex-wrap items-center gap-1.5 mt-1 text-[var(--text-secondary)]">
    <span className="tabular-nums">Kalan {formatMoney(debt.remainingAmountCents)}</span>
    {debt.dueDate ? <span className="tabular-nums">· Vade {formatDay(debt.dueDate)}</span> : null}
    {debt.isOverdue ? <Badge variant="red">Vadesi geçti</Badge> : null}
  </span>
);

const DebtButtons: React.FC<{ debt: LedgerDebt; actions: DebtActions; onClose: () => void }> = ({ debt, actions, onClose }) => (
  <div className="flex flex-wrap justify-end gap-2">
    {isEditable(debt) ? (
      <>
        <Button type="button" onClick={() => { onClose(); actions.onEdit(debt); }}>Düzenle</Button>
        <Button type="button" variant="danger" onClick={() => { onClose(); actions.onDelete(debt); }}>Sil</Button>
      </>
    ) : null}
    <Button type="button" variant="success" onClick={() => { onClose(); actions.onPay(debt); }}>
      {debt.type === 'GIVEN' ? 'Tahsilat' : 'Tediye'}
    </Button>
  </div>
);

interface StatementRowProps {
  line: StatementLine;
  /** Satırın açtığı kayıt hâlâ açıksa; ödeme satırlarında verilmez. */
  openDebt: LedgerDebt | null;
  actions: DebtActions;
}

export const StatementRow: React.FC<StatementRowProps> = ({ line, openDebt, actions }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OrderLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debit = line.signedAmountCents > 0 ? line.signedAmountCents : 0;
  const credit = line.signedAmountCents < 0 ? -line.signedAmountCents : 0;
  const purchase = line.purchaseOrderId ? purchaseLink(line) : null;

  const openDetail = async () => {
    setOpen(true);
    if (!line.orderId || loading || items) return;
    setLoading(true);
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setItems(await invokeIPC<OrderLine[]>('get_statement_order', { actorRole, tenantId, orderId: line.orderId }));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <tr className="border-b border-[var(--border)] align-top">
      <td className="px-3 py-2 whitespace-nowrap">{formatServerDateTime(line.createdAt)}</td>
      <td className="px-3 py-2">
        <span className="font-semibold">{lineLabel(line)}</span>
        {line.description ? <span className="text-[var(--text-secondary)]"> · {line.description}</span> : null}
        {openDebt ? <OpenDebtInfo debt={openDebt} /> : null}
      </td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">
        {line.orderId ? `Adisyon …${line.orderId.slice(-6)}` : purchase ?? ''}
      </td>
      <td className="px-3 py-2 text-right">{debit ? formatMoney(debit) : ''}</td>
      <td className="px-3 py-2 text-right">{credit ? formatMoney(credit) : ''}</td>
      <td className="px-3 py-2 text-right"><BalanceCell cents={line.balanceAfterCents} /></td>
      <td className="px-3 py-1 text-right">
        <Button type="button" variant="ghost" aria-label={`${lineLabel(line)} detayını aç`} onClick={() => void openDetail()}>Detay</Button>
        <Modal cardFlow isOpen={open} title={lineLabel(line)} subtitle={formatServerDateTime(line.createdAt)}
          maxWidth="sm" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-left">
            <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
              <div><dt className="text-[var(--text-secondary)]">{debit ? 'Borç' : 'Alacak'}</dt><dd className="font-bold">{formatMoney(debit || credit)}</dd></div>
              <div><dt className="text-[var(--text-secondary)]">İşlem Sonrası Bakiye</dt><dd className="font-bold"><BalanceCell cents={line.balanceAfterCents} /></dd></div>
            </dl>
            {line.description ? <p className="text-sm break-words">{line.description}</p> : null}
            {purchase ? <p className="text-sm">{purchase}</p> : null}
            {loading ? <p role="status" className="text-sm">Adisyon yükleniyor.</p> : null}
            {error ? <ErrorToast message={error} /> : null}
            {items ? (
              <section className="space-y-2">
                <h4 className="text-sm font-bold">Adisyon Kalemleri</h4>
                {items.length === 0 ? <p className="text-sm">Kalem kaydı yok.</p> : (
                  <ul className="divide-y divide-[var(--border)]">
                    {items.map((item, index) => (
                      <li key={`${item.name}-${index}`} className="flex justify-between gap-2 py-2 text-sm tabular-nums">
                        <span>{item.quantity} × {item.name}</span><span>{formatMoney(item.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
            {openDebt ? <>
              <OpenDebtInfo debt={openDebt} />
              <DebtButtons debt={openDebt} actions={actions} onClose={() => setOpen(false)} />
            </> : null}
          </div>
        </Modal>
      </td>
    </tr>
  );
};

/** Dönemden önce açılmış, hâlâ kapanmamış kayıt: tutarı açılış bakiyesinin içindedir. */
export const CarriedDebtRow: React.FC<{ debt: LedgerDebt; actions: DebtActions }> = ({ debt, actions }) => {
  const [open, setOpen] = useState(false);
  return (
    <tr className="border-b border-[var(--border)] align-top">
      <td className="px-3 py-2 whitespace-nowrap">{formatServerDateTime(debt.createdAt)}</td>
      <td className="px-3 py-2">
        <span className="font-semibold">{debtLabel(debt)}</span>
        {debt.description ? <span className="text-[var(--text-secondary)]"> · {debt.description}</span> : null}
        <OpenDebtInfo debt={debt} />
      </td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">Önceki dönem</td>
      <td colSpan={3} />
      <td className="px-3 py-1 text-right">
        <Button type="button" variant="ghost" aria-label={`${debtLabel(debt)} detayını aç`} onClick={() => setOpen(true)}>Detay</Button>
        <Modal cardFlow isOpen={open} title={debtLabel(debt)} subtitle={formatServerDateTime(debt.createdAt)}
          maxWidth="sm" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-left">
            <p className="font-bold tabular-nums">{formatMoney(debt.totalAmountCents)}</p>
            {debt.description ? <p className="text-sm break-words">{debt.description}</p> : null}
            <OpenDebtInfo debt={debt} />
            <DebtButtons debt={debt} actions={actions} onClose={() => setOpen(false)} />
          </div>
        </Modal>
      </td>
    </tr>
  );
};
