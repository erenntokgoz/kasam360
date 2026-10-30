import React, { useCallback, useEffect, useState } from 'react';
import { useCariStore } from '../../stores/cariStore';
import { localDate } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { CariOpenDebtModal } from './CariOpenDebtModal';
import { CariPaymentModal } from './CariPaymentModal';
import type { DirectoryContact, LedgerDebt, StatementLine } from '../../types/ledger';

const KIND_LABEL: Record<StatementLine['kind'], string> = {
  BORC_ACILDI: 'Kayıt',
  TAHSILAT: 'Tahsilat',
  TEDIYE: 'Tediye',
};

function linkLabel(item: { orderId?: string | null; documentNo?: string | null }): string | null {
  if (item.documentNo) return `Belge ${item.documentNo}`;
  if (item.orderId) return `Adisyon ${item.orderId}`;
  return null;
}

interface CariCardDetailProps {
  card: DirectoryContact;
  onChanged: () => void;
}

export const CariCardDetail: React.FC<CariCardDetailProps> = ({ card, onChanged }) => {
  const { debts, statement, loadCardDetail } = useCariStore();
  const [from, setFrom] = useState(() => {
    const today = new Date();
    return localDate(new Date(today.getFullYear(), today.getMonth(), 1));
  });
  const [to, setTo] = useState(() => localDate(new Date()));
  const [payingDebt, setPayingDebt] = useState<LedgerDebt | null>(null);
  const [isOpeningDebt, setIsOpeningDebt] = useState(false);

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
      <section className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">{card.name}</h3>
          <p className="text-[11px] text-[var(--text-muted)]">
            {card.phone || 'Telefon yok'}
            {card.taxNo ? ` · VKN ${card.taxNo}` : ''} · Limit{' '}
            <span className="tabular-nums">{formatMoney(card.creditLimitCents)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[11px] text-[var(--text-secondary)]">
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

      <section className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden">
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
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {debt.description || linkLabel(debt) || 'Açıklama yok'}
                    {debt.dueDate ? ` · Vade ${debt.dueDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="block font-bold text-sm tabular-nums text-[var(--text-primary)]">
                      {formatMoney(debt.remainingAmountCents)}
                    </span>
                    <span className="block text-[10px] tabular-nums text-[var(--text-muted)]">
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

      <section className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden">
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
                  <th className="px-3 py-2 font-semibold">Hareket</th>
                  <th className="px-3 py-2 font-semibold">Bağlantı</th>
                  <th className="px-3 py-2 font-semibold text-right">Tutar</th>
                  <th className="px-3 py-2 font-semibold text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-[var(--text-primary)]">
                <tr className="border-b border-[var(--border)]">
                  <td colSpan={4} className="px-3 py-2 text-[var(--text-secondary)]">
                    Açılış
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(statement.openingBalanceCents)}</td>
                </tr>
                {statement.lines.map((line) => (
                  <tr key={line.id} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(line.createdAt)}</td>
                    <td className="px-3 py-2">
                      {KIND_LABEL[line.kind]}
                      {line.description ? ` · ${line.description}` : ''}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{linkLabel(line) ?? '-'}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(line.signedAmountCents)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(line.balanceAfterCents)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td colSpan={4} className="px-3 py-2">
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
    </div>
  );
};
