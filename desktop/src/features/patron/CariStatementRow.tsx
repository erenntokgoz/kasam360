import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { sessionArgs } from '../../stores/cariStore';
import { errorText } from '../../lib/cariInput';
import { balanceSide, debtLabel, isEditable, lineLabel, purchaseLink } from '../../lib/cariLedger';
import { invokeIPC } from '../../services/tauriClient';
import { formatDay, formatServerDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
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

const DebtButtons: React.FC<{ debt: LedgerDebt; actions: DebtActions }> = ({ debt, actions }) => (
  <span className="flex items-center justify-end gap-1">
    <Button variant="success" onClick={() => actions.onPay(debt)} className="min-h-12">
      {debt.type === 'GIVEN' ? 'Tahsilat' : 'Tediye'}
    </Button>
    {isEditable(debt) ? (
      <>
        <Button variant="ghost" aria-label="Kaydı düzenle" onClick={() => actions.onEdit(debt)} className="min-h-12">
          <Pencil className="w-5 h-5" />
        </Button>
        <Button variant="ghost" aria-label="Kaydı sil" onClick={() => actions.onDelete(debt)} className="min-h-12">
          <Trash2 className="w-5 h-5" />
        </Button>
      </>
    ) : null}
  </span>
);

interface StatementRowProps {
  line: StatementLine;
  /** Satırın açtığı kayıt hâlâ açıksa; ödeme satırlarında verilmez. */
  openDebt: LedgerDebt | null;
  actions: DebtActions;
}

export const StatementRow: React.FC<StatementRowProps> = ({ line, openDebt, actions }) => {
  const [items, setItems] = useState<OrderLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debit = line.signedAmountCents > 0 ? line.signedAmountCents : 0;
  const credit = line.signedAmountCents < 0 ? -line.signedAmountCents : 0;
  const purchase = line.purchaseOrderId ? purchaseLink(line) : null;

  const toggle = async () => {
    if (items) {
      setItems(null);
      return;
    }
    try {
      const { actorRole, tenantId } = sessionArgs();
      setError(null);
      setItems(await invokeIPC<OrderLine[]>('get_statement_order', { actorRole, tenantId, orderId: line.orderId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <>
      <tr className="border-b border-[var(--border)] align-top">
        <td className="px-3 py-2 whitespace-nowrap">{formatServerDateTime(line.createdAt)}</td>
        <td className="px-3 py-2">
          <span className="font-semibold">{lineLabel(line)}</span>
          {line.description ? <span className="text-[var(--text-secondary)]"> · {line.description}</span> : null}
          {openDebt ? <OpenDebtInfo debt={openDebt} /> : null}
        </td>
        <td className="px-3 py-2 text-[var(--text-secondary)]">
          {line.orderId ? (
            <button type="button" className="min-h-12 underline cursor-pointer" onClick={() => void toggle()}>
              Adisyon …{line.orderId.slice(-6)}
            </button>
          ) : purchase ?? ''}
        </td>
        <td className="px-3 py-2 text-right">{debit ? formatMoney(debit) : ''}</td>
        <td className="px-3 py-2 text-right">{credit ? formatMoney(credit) : ''}</td>
        <td className="px-3 py-2 text-right"><BalanceCell cents={line.balanceAfterCents} /></td>
        <td className="px-3 py-1 text-right">{openDebt ? <DebtButtons debt={openDebt} actions={actions} /> : null}</td>
      </tr>
      {error ? (
        <tr><td colSpan={COLUMN_COUNT} role="alert" className="px-3 py-2 text-[var(--accent-red)]">{error}</td></tr>
      ) : null}
      {items ? (
        <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
          <td colSpan={COLUMN_COUNT} className="px-3 py-2">
            {items.length === 0 ? 'Kalem kaydı yok.' : items.map((item, index) => (
              <span key={`${item.name}-${index}`} className="block text-[var(--text-secondary)]">
                {item.quantity} × {item.name} · {formatMoney(item.totalCents)}
              </span>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
};

/** Dönemden önce açılmış, hâlâ kapanmamış kayıt: tutarı açılış bakiyesinin içindedir. */
export const CarriedDebtRow: React.FC<{ debt: LedgerDebt; actions: DebtActions }> = ({ debt, actions }) => (
  <tr className="border-b border-[var(--border)] align-top">
    <td className="px-3 py-2 whitespace-nowrap">{formatServerDateTime(debt.createdAt)}</td>
    <td className="px-3 py-2">
      <span className="font-semibold">{debtLabel(debt)}</span>
      {debt.description ? <span className="text-[var(--text-secondary)]"> · {debt.description}</span> : null}
      <OpenDebtInfo debt={debt} />
    </td>
    <td className="px-3 py-2 text-[var(--text-secondary)]">Önceki dönem</td>
    <td colSpan={3} />
    <td className="px-3 py-1 text-right"><DebtButtons debt={debt} actions={actions} /></td>
  </tr>
);
