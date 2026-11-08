import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { sessionArgs, useCariStore } from '../../stores/cariStore';
import { localDate, newOperationId } from '../../lib/cariInput';
import { balanceLabel } from '../../lib/cariLedger';
import { invokeIPC } from '../../services/tauriClient';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { CariCardModal } from './CariCardModal';
import { CariEditDebtModal } from './CariEditDebtModal';
import { CariOpenDebtModal } from './CariOpenDebtModal';
import { CariPaymentModal } from './CariPaymentModal';
import { CariPendingReceipts } from './CariPendingReceipts';
import { CariStatement } from './CariStatement';
import type { DirectoryContact, LedgerDebt, OpenDebtType } from '../../types/ledger';

interface CariCardDetailProps {
  card: DirectoryContact;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export const CariCardDetail: React.FC<CariCardDetailProps> = ({ card, onBack, onChanged, onDeleted }) => {
  const { debts, statement, awaiting, loadCardDetail, loadAwaiting, deleteCard } = useCariStore();
  const [range, setRange] = useState(() => {
    const today = localDate(new Date());
    return { from: today, to: today };
  });
  const [payingDebt, setPayingDebt] = useState<LedgerDebt | null>(null);
  const [editingDebt, setEditingDebt] = useState<LedgerDebt | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<LedgerDebt | null>(null);
  const [openingType, setOpeningType] = useState<OpenDebtType | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isSupplier = card.type === 'SUPPLIER';

  const reload = useCallback(
    () => loadCardDetail(card.id, range.from, range.to),
    [loadCardDetail, card.id, range.from, range.to]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (isSupplier) void loadAwaiting();
  }, [isSupplier, loadAwaiting]);

  const handleChanged = () => {
    setPayingDebt(null);
    setEditingDebt(null);
    setOpeningType(null);
    void reload();
    if (isSupplier) void loadAwaiting();
    onChanged();
  };

  const pending = isSupplier ? awaiting.filter((document) => document.directoryId === card.id) : [];

  return (
    <div className="space-y-4">
      <section className="paper border border-[var(--border)] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" onClick={onBack} aria-label="Kart listesine dön" className="min-h-12">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h3 className="print-title text-sm font-bold text-[var(--text-primary)] truncate">{card.name}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {card.phone || 'Telefon yok'}
              {isSupplier && card.taxNo ? ` · VKN ${card.taxNo}` : ''} · Limit{' '}
              <span className="tabular-nums">{formatMoney(card.creditLimitCents)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <span className="block text-xs text-[var(--text-secondary)]">{balanceLabel(card.balanceCents)}</span>
            <span className="text-base font-bold tabular-nums text-[var(--text-primary)]">
              {formatMoney(Math.abs(card.balanceCents))}
            </span>
          </div>
          <Button variant="secondary" onClick={() => setOpeningType('GIVEN')} className="min-h-12">
            Borç Yaz
          </Button>
          <Button variant="secondary" onClick={() => setOpeningType('TAKEN')} className="min-h-12">
            Alacak Yaz
          </Button>
          <Button variant="secondary" onClick={() => setIsEditing(true)} aria-label={`${card.name} düzenle`} className="min-h-12">
            <Pencil className="w-5 h-5" />
          </Button>
          <Button variant="ghost" onClick={() => setIsDeleting(true)} aria-label={`${card.name} sil`} className="min-h-12">
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>
      </section>

      <CariPendingReceipts documents={pending} onDone={handleChanged} />

      <CariStatement
        statement={statement}
        debts={debts}
        from={range.from}
        to={range.to}
        onRangeChange={(from, to) => setRange({ from, to })}
        actions={{ onPay: setPayingDebt, onEdit: setEditingDebt, onDelete: setDeletingDebt }}
      />

      {editingDebt ? (
        <CariEditDebtModal debt={editingDebt} onClose={() => setEditingDebt(null)} onSaved={handleChanged} />
      ) : null}
      {deletingDebt ? (
        <ConfirmDialog cardFlow
          title="Kayıt silinsin mi?"
          message={formatMoney(deletingDebt.totalAmountCents)}
          onConfirm={async () => {
            const { actorId, actorRole, tenantId } = sessionArgs();
            await invokeIPC('delete_debt', { actorRole, actorId, tenantId, operationId: newOperationId(), debtId: deletingDebt.id });
            handleChanged();
          }}
          onClose={() => setDeletingDebt(null)}
        />
      ) : null}
      <CariPaymentModal debt={payingDebt} onClose={() => setPayingDebt(null)} onPaid={handleChanged} />
      <CariOpenDebtModal
        card={card}
        type={openingType}
        onClose={() => setOpeningType(null)}
        onOpened={handleChanged}
      />
      {isDeleting ? (
        <ConfirmDialog cardFlow
          title={`${card.name} silinsin mi?`}
          message="Yalnız hareket görmemiş kart silinir."
          onConfirm={async () => {
            await deleteCard(card.id, newOperationId());
            onDeleted();
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
