import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useFloorStore } from '../../stores/floorStore';
import { useShiftStore } from '../../stores/shiftStore';
import { sessionArgs } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import { parseMoneyToCents } from '../../lib/moneyParser';
import { unitShareCents } from '../../lib/orderMath';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { PaymentItemSplitTab } from './PaymentItemSplitTab';
import { PaymentChannelSection } from './PaymentChannelSection';
import { ManagerPinPrompt } from './ManagerPinPrompt';
import type { PaymentMethod, PaymentResultWire, PaymentSplitMode, PaymentStatusWire } from '../../types/payment';

const SPLIT_TABS: { mode: PaymentSplitMode; label: string }[] = [
  { mode: 'FULL', label: 'Tam Hesap' },
  { mode: 'ITEMS', label: 'Kalem Bazlı Böl' },
  { mode: 'PARTIAL', label: 'Tutar Bazlı Böl' },
];

/** İş kuralı reddi kesindir: para alınmamıştır. Diğer hatalarda sonuç bilinmez. */
// Kodlu her hata işlem geri alındıktan sonra döner: para alınmamıştır. Kodsuz hata
// (bağlantı, disk) sonucu bilinmez sayılır ve sunucuya sorulur.
const DEFINITE_REJECTION = /^[A-Z][A-Z_]+:/;

function newTransactionId(): string {
  return `txn_${crypto.randomUUID()}`;
}

function parseCents(text: string): number | null {
  try {
    return parseMoneyToCents(text);
  } catch {
    return null;
  }
}

export const PaymentModal: React.FC = () => {
  const { modals, closeModal, openModal } = useUIStore();
  const { activeTableName, activeTableId, activeOrderId, balance, ticketItems, loadActiveOrder, setLastSale } = usePosStore();
  const { directories, createContact, loadLedgerData } = useLedgerStore();
  const { loadFloorPlan } = useFloorStore();
  const { loadShiftData } = useShiftStore();

  const remainingCents = balance?.remainingCents ?? 0;
  const payableItems = useMemo(() => ticketItems.filter((item) => item.isSentToKitchen), [ticketItems]);

  const [splitMode, setSplitMode] = useState<PaymentSplitMode>('FULL');
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({});
  const [customPartial, setCustomPartial] = useState('');
  const [discountCents, setDiscountCents] = useState(0);
  const [channel, setChannel] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnresolved, setIsUnresolved] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);

  // Aynı niyet aynı kimlikle gider: yeniden deneme ikinci tahsilat olamaz.
  const transactionId = useRef(newTransactionId());

  useEffect(() => {
    if (modals.payment) void loadLedgerData();
  }, [modals.payment, loadLedgerData]);

  if (!modals.payment) return null;

  let payNowCents = 0;
  if (splitMode === 'FULL') {
    payNowCents = Math.max(0, remainingCents - discountCents);
  } else if (splitMode === 'ITEMS') {
    payNowCents = payableItems.reduce(
      (sum, item) => sum + unitShareCents(item, selectedItemQuantities[item.id] || 0),
      0,
    );
  } else {
    payNowCents = Math.min(remainingCents, parseCents(customPartial) ?? 0);
  }

  const handleQuickFlatRounding = () => {
    const liras = Math.floor(remainingCents / 100);
    const target = liras - (liras % 50) || Math.floor(liras / 10) * 10;
    setDiscountCents(Math.max(0, remainingCents - target * 100));
  };

  const toggleItemSelect = (itemId: string, maxQty: number) => {
    setSelectedItemQuantities((prev) => {
      const current = prev[itemId] || 0;
      return { ...prev, [itemId]: current >= maxQty ? 0 : current + 1 };
    });
  };

  const selectAllItems = () => {
    setSelectedItemQuantities(Object.fromEntries(payableItems.map((item) => [item.id, item.quantity])));
  };

  const handleCreateCari = async (name: string, phone: string) => {
    const created = await createContact(name, phone, 'CUSTOMER');
    setSelectedDirectoryId(created.id);
  };

  const tenderedCents = channel === 'CASH' && tendered ? parseCents(tendered) : payNowCents;

  const finishSale = async (changeCents: number, remaining: number) => {
    setLastSale({
      transactionId: transactionId.current,
      tableName: activeTableName,
      items: splitMode === 'ITEMS'
        ? payableItems
            .filter((item) => selectedItemQuantities[item.id])
            .map((item) => ({
              ...item,
              quantity: selectedItemQuantities[item.id],
              totalCents: unitShareCents(item, selectedItemQuantities[item.id]),
            }))
        : payableItems,
      amountCents: payNowCents,
      method: channel,
      changeCents,
      remainingCents: remaining,
    });
    transactionId.current = newTransactionId();
    setSelectedItemQuantities({});
    setCustomPartial('');
    setDiscountCents(0);
    setTendered('');
    setSplitMode('FULL');
    setIsUnresolved(false);
    setErrorMsg(null);
    await Promise.all([loadActiveOrder(), loadFloorPlan(), loadShiftData()]);
    closeModal('payment');
    openModal('receiptPreview');
  };

  const execute = async (approvalToken?: string) => {
    const { actorId, actorRole } = sessionArgs();
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const reply = await invokeIPC<PaymentResultWire>('process_payment', {
        actorRole,
        payload: {
          transactionId: transactionId.current,
          orderId: activeOrderId,
          timestamp: new Date().toISOString(),
          method: channel,
          amountTendered: tenderedCents,
          totalAmount: payNowCents,
          changeAmount: (tenderedCents ?? payNowCents) - payNowCents,
          items: splitMode === 'ITEMS'
            ? payableItems
                .filter((item) => selectedItemQuantities[item.id])
                .map((item) => ({
                  id: item.id,
                  product: { id: item.productId },
                  quantity: selectedItemQuantities[item.id],
                }))
            : [],
          customerRef: activeTableId,
          cashierId: actorId,
          actorId,
          debtDirectoryId: channel === 'VERESIYE' ? selectedDirectoryId : undefined,
          globalDiscount: discountCents > 0 ? { type: 'FIXED_AMOUNT', value: discountCents } : undefined,
          approvalToken,
        },
      });
      await finishSale((tenderedCents ?? payNowCents) - payNowCents, reply.remainingCents ?? 0);
    } catch (caught) {
      const message = errorText(caught);
      if (message.startsWith('IDEMPOTENCY_CONFLICT')) {
        await checkOutcome();
      } else if (DEFINITE_REJECTION.test(message)) {
        setErrorMsg(message);
        await loadActiveOrder();
      } else {
        setIsUnresolved(true);
        setErrorMsg(`Tahsilat sonucu doğrulanamadı. İşlem kimliği: ${transactionId.current}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // İkinci gönderimden önce sunucuya sorulur: para alınmışsa tekrar alınmaz.
  const checkOutcome = async () => {
    const { tenantId } = sessionArgs();
    setIsProcessing(true);
    try {
      const status = await invokeIPC<PaymentStatusWire>('get_payment_status', {
        transactionId: transactionId.current,
        orderId: activeOrderId,
        tenantId,
      });
      if (status.processed) {
        await finishSale((tenderedCents ?? payNowCents) - payNowCents, status.balance.remainingCents);
      } else {
        setIsUnresolved(false);
        setErrorMsg('Tahsilat kaydedilmemiş. Aynı işlem kimliğiyle güvenle yeniden deneyebilirsiniz.');
      }
    } catch (caught) {
      setErrorMsg(`Sonuç sorgulanamadı: ${errorText(caught)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecutePayment = () => {
    if (!activeOrderId) {
      setErrorMsg('Açık adisyon bulunamadı.');
    } else if (payNowCents <= 0) {
      setErrorMsg('Tahsil edilecek tutar sıfırdan büyük olmalıdır.');
    } else if (channel === 'VERESIYE' && !selectedDirectoryId) {
      setErrorMsg('Veresiye işlemi için lütfen bir cari müşteri seçin.');
    } else if (tenderedCents === null || tenderedCents < payNowCents) {
      setErrorMsg('Verilen nakit tahsilat tutarından az olamaz.');
    } else if (discountCents > 0) {
      setNeedsApproval(true);
    } else {
      void execute();
    }
  };

  return (
    <Modal
      isOpen={modals.payment}
      onClose={() => {
        if (!isUnresolved && !isProcessing) closeModal('payment');
      }}
      title={`${activeTableName} Tahsilatı`}
      subtitle="Ödeme yöntemini ve tahsilat tipini seçin"
      maxWidth="2xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Adisyonun Kalan Bakiyesi</span>
            <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
              {balance ? formatMoney(remainingCents) : 'Okunamadı'}
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
          <div role="alert" className="p-3 rounded-lg text-xs font-medium text-center break-all bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-3 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          {SPLIT_TABS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              disabled={isUnresolved}
              onClick={() => {
                setSplitMode(mode);
                setDiscountCents(0);
              }}
              className={`min-h-12 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                splitMode === mode
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {splitMode === 'FULL' ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block">Düz Hesap Yuvarlama</span>
              <span className="text-xs text-[var(--text-secondary)] block mt-0.5">
                Küsürat yönetici onayıyla indirim olarak düşer
                {discountCents > 0 ? ` (Uygulanan İndirim: ${formatMoney(discountCents)})` : ''}
              </span>
            </div>
            <Button variant="outline-amber" size="sm" onClick={handleQuickFlatRounding} className="min-h-12 text-xs">
              Düz Hesap Yap
            </Button>
          </div>
        ) : null}

        {splitMode === 'ITEMS' ? (
          <PaymentItemSplitTab
            items={payableItems}
            selectedQuantities={selectedItemQuantities}
            onToggleItem={toggleItemSelect}
            onSelectAll={selectAllItems}
          />
        ) : null}

        {splitMode === 'PARTIAL' ? (
          <div className="space-y-2">
            <label htmlFor="payment-partial" className="block text-xs font-medium text-[var(--text-secondary)]">
              Tahsil Edilecek Tutar (₺)
            </label>
            <div className="flex gap-2">
              <Input
                id="payment-partial"
                inputMode="decimal"
                value={customPartial}
                onChange={(e) => setCustomPartial(e.target.value)}
                placeholder="Örn: 500"
                className="min-h-12 text-base font-bold tabular-nums flex-1"
                autoFocus
              />
              <Button
                variant="secondary"
                size="md"
                className="min-h-12"
                onClick={() => setCustomPartial((Math.ceil(remainingCents / 2) / 100).toFixed(2).replace('.', ','))}
              >
                1/2 Hesap
              </Button>
            </div>
          </div>
        ) : null}

        <PaymentChannelSection
          channel={channel}
          onSelectChannel={setChannel}
          payNowCents={payNowCents}
          tenderedLiras={tendered}
          onChangeTendered={setTendered}
          directories={directories}
          selectedDirectoryId={selectedDirectoryId}
          onSelectDirectory={setSelectedDirectoryId}
          onCreateContact={handleCreateCari}
        />

        {isUnresolved ? (
          <Button variant="primary" size="xl" onClick={() => void checkOutcome()} isLoading={isProcessing} className="w-full mt-2 text-base font-bold">
            Tahsilat Sonucunu Sorgula
          </Button>
        ) : (
          <Button variant="success" size="xl" onClick={handleExecutePayment} isLoading={isProcessing} className="w-full mt-2 text-base font-bold">
            <Check className="w-5 h-5 mr-1.5" />
            <span>{formatMoney(payNowCents)} Tahsilatı Tamamla</span>
          </Button>
        )}
      </div>

      {needsApproval ? (
        <ManagerPinPrompt
          title="İndirim Onayı"
          scope={{
            operation: 'DISCOUNT',
            resourceId: transactionId.current,
            amountCents: discountCents,
            discountPercent: Math.round((discountCents * 100) / remainingCents),
          }}
          onClose={() => setNeedsApproval(false)}
          onApproved={(token) => {
            setNeedsApproval(false);
            void execute(token);
          }}
        />
      ) : null}
    </Modal>
  );
};
