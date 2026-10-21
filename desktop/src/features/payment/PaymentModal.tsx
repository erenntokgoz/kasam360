import React, { useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useFloorStore } from '../../stores/floorStore';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { PaymentItemSplitTab } from './PaymentItemSplitTab';
import { PaymentChannelSection } from './PaymentChannelSection';
import type { PaymentMethod, PaymentSplitMode } from '../../types/payment';

export const PaymentModal: React.FC = () => {
  const { modals, closeModal, openModal } = useUIStore();
  const {
    activeTableName,
    activeTableId,
    ticketItems,
    calculateTotalCents,
    clearTicket,
    deductPaidItems,
    deductPaidAmount,
  } = usePosStore();
  const { user } = useAuthStore();
  const { directories, createContact } = useLedgerStore();
  const { loadFloorPlan, updateTablePayment } = useFloorStore();

  const totalOrderCents = calculateTotalCents();

  const [splitMode, setSplitMode] = useState<PaymentSplitMode>('FULL');
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({});
  const [customPartialLiras, setCustomPartialLiras] = useState<string>('');
  const [discountCents, setDiscountCents] = useState<number>(0);

  const [channel, setChannel] = useState<PaymentMethod>('CASH');
  const [tenderedLiras, setTenderedLiras] = useState<string>('');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string>('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!modals.payment) return null;

  // Hesaplama: Şu an tahsil edilecek tutar
  let payNowCents = 0;
  if (splitMode === 'FULL') {
    payNowCents = Math.max(0, totalOrderCents - discountCents);
  } else if (splitMode === 'ITEMS') {
    payNowCents = ticketItems.reduce((acc, item) => {
      const qty = selectedItemQuantities[item.id] || 0;
      return acc + qty * item.unitPriceCents;
    }, 0);
  } else if (splitMode === 'PARTIAL') {
    const entered = parseFloat(customPartialLiras) || 0;
    payNowCents = Math.min(totalOrderCents, Math.round(entered * 100));
  }

  // Düz Hesap Yuvarlama
  const handleQuickFlatRounding = () => {
    const liras = Math.floor(totalOrderCents / 100);
    const remainder = liras % 50;
    let targetLira = liras - remainder;
    if (targetLira <= 0) targetLira = Math.floor(liras / 10) * 10;
    const targetCents = targetLira * 100;
    const discount = Math.max(0, totalOrderCents - targetCents);
    setDiscountCents(discount);
  };

  // Kalem Seçimi (Alman Usulü)
  const toggleItemSelect = (itemId: string, maxQty: number) => {
    setSelectedItemQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = current >= maxQty ? 0 : current + 1;
      return { ...prev, [itemId]: next };
    });
  };

  const selectAllItems = () => {
    const all: Record<string, number> = {};
    ticketItems.forEach((i) => {
      all[i.id] = i.quantity;
    });
    setSelectedItemQuantities(all);
  };

  const handleCreateCari = async (name: string, phone: string) => {
    const created = await createContact(name, phone, 'CUSTOMER');
    setSelectedDirectoryId(created.id);
  };

  // Tahsilatı Tamamla
  const handleExecutePayment = async () => {
    if (payNowCents <= 0) {
      setErrorMsg('Tahsil edilecek tutar sıfırdan büyük olmalıdır.');
      return;
    }
    if (channel === 'VERESIYE' && !selectedDirectoryId) {
      setErrorMsg('Veresiye işlemi için lütfen bir cari müşteri seçin.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      await invokeIPC('process_payment', {
        orderId: `ord_${activeTableId || 'walkin'}`,
        amountCents: payNowCents,
        paymentMethod: channel,
        splitMode,
        discountCents,
        directoryId: channel === 'VERESIYE' ? selectedDirectoryId : undefined,
        cashierId: user?.userId || 'usr_cashier',
      });

      const isFullOrCovered = splitMode === 'FULL' || payNowCents >= totalOrderCents;

      if (isFullOrCovered) {
        clearTicket();
        if (activeTableId) {
          updateTablePayment(activeTableId, payNowCents, true);
        }
      } else if (splitMode === 'ITEMS') {
        deductPaidItems(selectedItemQuantities);
        if (activeTableId) {
          updateTablePayment(activeTableId, payNowCents, false);
        }
        setSelectedItemQuantities({});
      } else if (splitMode === 'PARTIAL') {
        deductPaidAmount(payNowCents);
        if (activeTableId) {
          updateTablePayment(activeTableId, payNowCents, false);
        }
        setCustomPartialLiras('');
      }

      await loadFloorPlan();
      closeModal('payment');
      openModal('receiptPreview');
    } catch {
      setErrorMsg('Tahsilat işlemi tamamlanamadı. Lütfen tekrar deneyin.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={modals.payment}
      onClose={() => closeModal('payment')}
      title={`${activeTableName} Tahsilatı`}
      subtitle="Ödeme yöntemini ve tahsilat tipini seçin"
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {/* Üst Bakiye Kartları */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Masanın Kalan Bakiyesi</span>
            <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
              {formatMoney(totalOrderCents)}
            </span>
          </div>

          <div className="bg-[var(--bg-subtle)] border border-[var(--accent-emerald-border)] rounded-xl p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Şu An Tahsil Edilecek</span>
            <span className="text-xl font-bold text-[var(--accent-emerald)] tabular-nums mt-0.5 block">
              {formatMoney(payNowCents)}
            </span>
          </div>
        </div>

        {errorMsg ? (
          <div className="p-3 rounded-lg text-xs font-medium text-center bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {/* 3 Sekmeli Tahsilat Modu */}
        <div className="grid grid-cols-3 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setSplitMode('FULL')}
            className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              splitMode === 'FULL'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Tam Hesap
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('ITEMS')}
            className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              splitMode === 'ITEMS'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Kalem Bazlı Böl
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('PARTIAL')}
            className={`py-2 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
              splitMode === 'PARTIAL'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Tutar Bazlı Böl
          </button>
        </div>

        {/* Sekme 1: Tam Hesap */}
        {splitMode === 'FULL' ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Düz Hesap Yuvarlama
              </span>
              <span className="text-xs text-[var(--text-secondary)] block mt-0.5">
                Küsüratı otomatik indirim olarak düşer
                {discountCents > 0 ? ` (Uygulanan İndirim: ${formatMoney(discountCents)})` : ''}
              </span>
            </div>
            <Button
              variant="outline-amber"
              size="sm"
              onClick={handleQuickFlatRounding}
              className="text-xs"
            >
              Düz Hesap Yap
            </Button>
          </div>
        ) : null}

        {/* Sekme 2: Alman Usulü Kalem Seçimi */}
        {splitMode === 'ITEMS' ? (
          <PaymentItemSplitTab
            items={ticketItems}
            selectedQuantities={selectedItemQuantities}
            onToggleItem={toggleItemSelect}
            onSelectAll={selectAllItems}
          />
        ) : null}

        {/* Sekme 3: Kısmi / Düz Hesap */}
        {splitMode === 'PARTIAL' ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Tahsil Edilecek Tutar (₺)
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="1"
                min="1"
                value={customPartialLiras}
                onChange={(e) => setCustomPartialLiras(e.target.value)}
                placeholder="Örn: 500"
                className="text-base font-bold tabular-nums flex-1"
                autoFocus
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => setCustomPartialLiras((totalOrderCents / 200).toString())}
              >
                1/2 Hesap
              </Button>
            </div>
          </div>
        ) : null}

        {/* Ödeme Kanalı Bölümü */}
        <PaymentChannelSection
          channel={channel}
          onSelectChannel={setChannel}
          payNowCents={payNowCents}
          tenderedLiras={tenderedLiras}
          onChangeTendered={setTenderedLiras}
          directories={directories}
          selectedDirectoryId={selectedDirectoryId}
          onSelectDirectory={setSelectedDirectoryId}
          onCreateContact={handleCreateCari}
        />

        {/* Tahsilatı Onayla Butonu */}
        <Button
          variant="success"
          size="xl"
          onClick={handleExecutePayment}
          isLoading={isProcessing}
          className="w-full mt-2 text-base font-bold"
        >
          <Check className="w-5 h-5 mr-1.5" />
          <span>{formatMoney(payNowCents)} Tahsilatı Tamamla</span>
        </Button>
      </div>
    </Modal>
  );
};
