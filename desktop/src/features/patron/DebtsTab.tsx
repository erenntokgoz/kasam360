import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';

export const DebtsTab: React.FC = () => {
  const { debts, directories, payDebt, createContact } = useLedgerStore();

  const [payingDebtId, setPayingDebtId] = useState<string | null>(null);
  const [payAmountLiras, setPayAmountLiras] = useState('');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactType, setNewContactType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');

  const selectedDebt = debts.find((d) => d.id === payingDebtId) || null;

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingDebtId) return;
    const liras = parseFloat(payAmountLiras) || 0;
    const cents = Math.round(liras * 100);
    await payDebt(payingDebtId, cents);
    setPayingDebtId(null);
    setPayAmountLiras('');
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName) return;
    await createContact(newContactName, newContactPhone, newContactType);
    setShowAddContactModal(false);
    setNewContactName('');
    setNewContactPhone('');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Borç & Alacak Defteri</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Müşteri veresiyeleri ve tedarikçi borçlarının net bakiye takibi.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowAddContactModal(true)}
          className="text-xs"
        >
          + Yeni Cari Ekle
        </Button>
      </div>

      {/* Cari Bakiye Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {directories.map((dir) => (
          <div
            key={dir.id}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3.5 flex flex-col justify-between shadow-sm"
          >
            <div>
              <div className="flex items-start justify-between">
                <span className="text-xs font-bold text-[var(--text-primary)] block truncate">
                  {dir.name}
                </span>
                <Badge variant={dir.type === 'SUPPLIER' ? 'amber' : 'blue'}>
                  {dir.type === 'SUPPLIER' ? 'Tedarikçi' : 'Müşteri'}
                </Badge>
              </div>
              <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                {dir.phone || 'Telefon yok'}
              </span>
            </div>

            <div className="mt-3 pt-2 border-t border-[var(--border)] flex items-baseline justify-between">
              <span className="text-[11px] text-[var(--text-secondary)]">Bakiye:</span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  dir.balanceCents > 0
                    ? 'text-[var(--accent-emerald)]'
                    : dir.balanceCents < 0
                    ? 'text-[var(--accent-red)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                {formatMoney(dir.balanceCents)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Borç & Alacak Hareket Listesi */}
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[var(--border)] font-bold text-xs text-[var(--text-primary)]">
          Açık Borç ve Alacak Hareketleri
        </div>

        <div className="divide-y divide-[var(--border)] text-xs">
          {debts.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">
              Kayıtlı açık borç veya alacak bulunmuyor.
            </div>
          ) : (
            debts.map((debt) => (
              <div
                key={debt.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--text-primary)]">{debt.directoryName}</span>
                    <Badge variant={debt.debtType === 'RECEIVABLE' ? 'emerald' : 'red'}>
                      {debt.debtType === 'RECEIVABLE' ? 'Alacağımız' : 'Borcumuz'}
                    </Badge>
                    {debt.isPaid ? <Badge variant="neutral">Ödendi</Badge> : null}
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                    {debt.description} · {formatDateTime(debt.createdAt)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="font-bold text-sm tabular-nums text-[var(--text-primary)] block">
                      {formatMoney(debt.remainingCents)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] block">
                      Toplam: {formatMoney(debt.amountCents)}
                    </span>
                  </div>

                  {!debt.isPaid ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPayingDebtId(debt.id);
                        setPayAmountLiras((debt.remainingCents / 100).toString());
                      }}
                      className="text-xs !min-h-[34px]"
                    >
                      Ödeme Yap
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ödeme Modalı */}
      <Modal
        isOpen={payingDebtId !== null}
        onClose={() => setPayingDebtId(null)}
        title="Borç / Alacak Tahsilatı"
        subtitle={selectedDebt?.directoryName}
        maxWidth="sm"
      >
        <form onSubmit={handleConfirmPayment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Ödenecek Tutar (₺)
            </label>
            <Input
              type="number"
              min="1"
              step="1"
              value={payAmountLiras}
              onChange={(e) => setPayAmountLiras(e.target.value)}
              className="text-base font-bold tabular-nums"
              required
              autoFocus
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPayingDebtId(null)}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button type="submit" variant="success" className="flex-1">
              Ödemeyi Kaydet
            </Button>
          </div>
        </form>
      </Modal>

      {/* Yeni Cari Ekleme Modalı */}
      <Modal
        isOpen={showAddContactModal}
        onClose={() => setShowAddContactModal(false)}
        title="Yeni Cari Kartı Oluştur"
        subtitle="Müşteri veya tedarikçi kartını sisteme kaydedin."
        maxWidth="sm"
      >
        <form onSubmit={handleCreateContact} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Adı / Firma Ünvanı
            </label>
            <Input
              type="text"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="Örn: Kasap Halil"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Telefon
            </label>
            <Input
              type="text"
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
              placeholder="0532..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Cari Türü
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={newContactType === 'CUSTOMER' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setNewContactType('CUSTOMER')}
              >
                Müşteri
              </Button>
              <Button
                type="button"
                variant={newContactType === 'SUPPLIER' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setNewContactType('SUPPLIER')}
              >
                Tedarikçi
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAddContactModal(false)}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
