import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { sessionArgs, useCariStore } from '../../stores/cariStore';
import { errorText, localDate, newOperationId } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { formatServerDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { CariCardModal } from './CariCardModal';
import { CariOpenDebtModal } from './CariOpenDebtModal';
import { CariPaymentModal } from './CariPaymentModal';
import type { DirectoryContact, LedgerDebt, StatementLine } from '../../types/ledger';

interface OrderLine {
  name: string;
  quantity: number;
  totalCents: number;
}

const KIND_LABEL: Record<StatementLine['kind'], string> = {
  BORC_ACILDI: 'Kayıt',
  TAHSILAT: 'Tahsilat',
  TEDIYE: 'Tediye',
  IADE: 'İade',
};

function linkLabel(item: { orderId?: string | null; documentNo?: string | null }): string | null {
  if (item.documentNo) return `Belge ${item.documentNo}`;
  if (item.orderId) return `Adisyon …${item.orderId.slice(-6)}`;
  return null;
}

const StatementRow: React.FC<{ line: StatementLine }> = ({ line }) => {
  const [items, setItems] = useState<OrderLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = linkLabel(line);
  const debit = line.signedAmountCents > 0 ? line.signedAmountCents : 0;
  const credit = line.signedAmountCents < 0 ? -line.signedAmountCents : 0;

  const toggle = async () => {
    if (items) {
      setItems(null);
      return;
    }
    const { actorRole, tenantId } = sessionArgs();
    try {
      setError(null);
      setItems(await invokeIPC<OrderLine[]>('get_statement_order', { actorRole, tenantId, orderId: line.orderId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <>
      <tr className="border-b border-[var(--border)]">
        <td className="px-3 py-2 whitespace-nowrap">{formatServerDateTime(line.createdAt)}</td>
        <td className="px-3 py-2">
          {KIND_LABEL[line.kind]}
          {line.description ? ` · ${line.description}` : ''}
        </td>
        <td className="px-3 py-2 text-[var(--text-secondary)]">
          {line.orderId && !line.documentNo ? (
            <button type="button" className="min-h-12 underline cursor-pointer" onClick={() => void toggle()}>{label}</button>
          ) : label ?? '-'}
        </td>
        <td className="px-3 py-2 text-right">{debit ? formatMoney(debit) : ''}</td>
        <td className="px-3 py-2 text-right">{credit ? formatMoney(credit) : ''}</td>
        <td className="px-3 py-2 text-right">{formatMoney(line.balanceAfterCents)}</td>
      </tr>
      {error ? (
        <tr><td colSpan={6} role="alert" className="px-3 py-2 text-[var(--accent-red)]">{error}</td></tr>
      ) : null}
      {items ? (
        <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
          <td colSpan={6} className="px-3 py-2">
            {items.length === 0 ? 'Kalem kaydı yok.' : items.map((item) => (
              <span key={item.name} className="block text-[var(--text-secondary)]">{item.quantity} × {item.name} · {formatMoney(item.totalCents)}</span>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
};

interface CariCardDetailProps {
  card: DirectoryContact;
  onChanged: () => void;
}

export const CariCardDetail: React.FC<CariCardDetailProps> = ({ card, onChanged }) => {
  const { debts, statement, loadCardDetail, deleteCard } = useCariStore();
  const [from, setFrom] = useState(() => {
    const today = new Date();
    return localDate(new Date(today.getFullYear(), today.getMonth(), 1));
  });
  const [to, setTo] = useState(() => localDate(new Date()));
  const [payingDebt, setPayingDebt] = useState<LedgerDebt | null>(null);
  const [isOpeningDebt, setIsOpeningDebt] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(() => loadCardDetail(card.id, from, to), [loadCardDetail, card.id, from, to]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleChanged = () => {
    setPayingDebt(null);
    setIsOpeningDebt(false);
    void reload();
    onChanged();
  };

  const openDebts = debts.filter((debt) => debt.status !== 'PAID');

  return (
    <div className="space-y-4">
      <section className="paper border border-[var(--border)] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="print-title text-sm font-bold text-[var(--text-primary)] truncate">{card.name}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {card.phone || 'Telefon yok'}
            {card.taxNo ? ` · VKN ${card.taxNo}` : ''} · Limit{' '}
            <span className="tabular-nums">{formatMoney(card.creditLimitCents)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setIsEditing(true)} aria-label={`${card.name} düzenle`}>
            <Pencil className="w-5 h-5" />
            <span>Düzenle</span>
          </Button>
          <Button variant="ghost" onClick={() => setIsDeleting(true)} aria-label={`${card.name} sil`}>
            <Trash2 className="w-5 h-5" />
          </Button>
          <div className="text-right">
            <span className="block text-xs text-[var(--text-secondary)]">
              {card.balanceCents >= 0 ? 'Alacağımız' : 'Borcumuz'}
            </span>
            <span className="text-base font-bold tabular-nums text-[var(--text-primary)]">
              {formatMoney(Math.abs(card.balanceCents))}
            </span>
          </div>
          <Button variant="secondary" onClick={() => setIsOpeningDebt(true)} className="min-h-12">
            Borç / Alacak Aç
          </Button>
        </div>
      </section>

      <section className="paper border border-[var(--border)] rounded-xl overflow-hidden">
        <h4 className="px-4 py-3 border-b border-[var(--border)] text-xs font-bold text-[var(--text-primary)]">
          Açık Kayıtlar
        </h4>
        {openDebts.length === 0 ? (
          <p className="p-5 text-center text-xs text-[var(--text-muted)]">Açık kayıt yok.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {openDebts.map((debt) => (
              <li key={debt.id} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={debt.type === 'GIVEN' ? 'emerald' : 'red'}>
                      {debt.type === 'GIVEN' ? 'Alacağımız' : 'Borcumuz'}
                    </Badge>
                    {debt.status === 'PARTIAL' ? <Badge variant="neutral">Kısmi</Badge> : null}
                    {debt.isOverdue ? <Badge variant="red">Vadesi geçti</Badge> : null}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {debt.description || linkLabel(debt) || 'Açıklama yok'}
                    {debt.dueDate ? ` · Vade ${debt.dueDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="block font-bold text-sm tabular-nums text-[var(--text-primary)]">
                      {formatMoney(debt.remainingAmountCents)}
                    </span>
                    <span className="block text-xs tabular-nums text-[var(--text-muted)]">
                      Toplam {formatMoney(debt.totalAmountCents)}
                    </span>
                  </div>
                  <Button variant="success" onClick={() => setPayingDebt(debt)} className="min-h-12">
                    Ödeme
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="paper border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-[var(--text-primary)]">Ekstre</h4>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Başlangıç"
              className="w-40 tabular-nums"
            />
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Bitiş"
              className="w-40 tabular-nums"
            />
          </div>
        </div>
        {statement ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[var(--text-secondary)] text-left">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-semibold">Tarih</th>
                  <th className="px-3 py-2 font-semibold">İşlem</th>
                  <th className="px-3 py-2 font-semibold">Belge</th>
                  <th className="px-3 py-2 font-semibold text-right">Borç</th>
                  <th className="px-3 py-2 font-semibold text-right">Alacak</th>
                  <th className="px-3 py-2 font-semibold text-right">Yürüyen Bakiye</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-[var(--text-primary)]">
                <tr className="border-b border-[var(--border)]">
                  <td colSpan={5} className="px-3 py-2 text-[var(--text-secondary)]">
                    Açılış
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(statement.openingBalanceCents)}</td>
                </tr>
                {statement.lines.map((line) => (
                  <StatementRow key={line.id} line={line} />
                ))}
                <tr className="font-bold">
                  <td colSpan={5} className="px-3 py-2">
                    Kapanış
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(statement.closingBalanceCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <CariPaymentModal debt={payingDebt} onClose={() => setPayingDebt(null)} onPaid={handleChanged} />
      <CariOpenDebtModal
        card={card}
        isOpen={isOpeningDebt}
        onClose={() => setIsOpeningDebt(false)}
        onOpened={handleChanged}
      />
      {isDeleting ? (
        <ConfirmDialog
          title={`${card.name} silinsin mi?`}
          message="Yalnız hareket görmemiş kart silinir."
          onConfirm={async () => {
            await deleteCard(card.id, newOperationId());
            onChanged();
          }}
          onClose={() => setIsDeleting(false)}
        />
      ) : null}

      <CariCardModal
        isOpen={isEditing}
        directoryType={card.type}
        card={card}
        onClose={() => setIsEditing(false)}
        onCreated={() => {
          setIsEditing(false);
          onChanged();
        }}
      />
    </div>
  );
};
