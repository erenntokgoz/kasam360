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
import { syncErrorText } from '../../lib/syncError';
import { invokeIPC } from '../../services/tauriClient';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { PaymentItemSplitTab } from './PaymentItemSplitTab';
import { PaymentChannelSection } from './PaymentChannelSection';
import { OrderStatusBanner } from '../pos/OrderStatusBanner';
import { ManagerPinPrompt } from './ManagerPinPrompt';
import type { PaymentMethod, PaymentResultWire, PaymentSplitMode, PaymentStatusWire } from '../../types/payment';

const SPLIT_TABS: { mode: PaymentSplitMode; label: string }[] = [
  { mode: 'FULL', label: 'Tam Hesap' },
  { mode: 'ITEMS', label: 'Kaleme Göre' },
  { mode: 'PARTIAL', label: 'Tutara Göre' },
];

/** İş kuralı reddi kesindir: para alınmamıştır. Diğer hatalarda sonuç bilinmez. */
// Kodlu her hata işlem geri alındıktan sonra döner: para alınmamıştır. Kodsuz hata
// (bağlantı, disk) ve `PENDING_RESULT` sonucu bilinmez sayılır ve sunucuya sorulur.
const DEFINITE_REJECTION = /^(?!PENDING_RESULT)[A-Z][A-Z_]+:/;

function newTransactionId(): string {
  return `txn_${crypto.randomUUID()}`;
}

type TestScenario = 'APPROVE' | 'DECLINE' | 'CANCEL' | 'DUPLICATE_RESPONSE' | 'LATE_DECLINE';

const TEST_SCENARIOS: { value: TestScenario; label: string }[] = [
  { value: 'APPROVE', label: 'Başarılı' },
  { value: 'DECLINE', label: 'Başarısız' },
  { value: 'CANCEL', label: 'İptal' },
  { value: 'DUPLICATE_RESPONSE', label: 'Tekrarlanan yanıt' },
  { value: 'LATE_DECLINE', label: 'Geç gelen ret' },
];

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
  const { directories, createContact, loadDirectories } = useLedgerStore();
  const { loadFloorPlan } = useFloorStore();
  const { activeShift, loadShiftData } = useShiftStore();

  const remainingCents = balance?.remainingCents ?? 0;
  const payableItems = useMemo(() => ticketItems.filter((item) => item.isSentToKitchen), [ticketItems]);

  const [splitMode, setSplitMode] = useState<PaymentSplitMode>('FULL');
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({});
  const [customPartial, setCustomPartial] = useState('');
  const [channel, setChannel] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnresolved, setIsUnresolved] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testScenario, setTestScenario] = useState<TestScenario>('APPROVE');
  const [discountText, setDiscountText] = useState('');
  const [discountToken, setDiscountToken] = useState<string | null>(null);
  const [askDiscountPin, setAskDiscountPin] = useState(false);

  // Aynı niyet aynı kimlikle gider: yeniden deneme ikinci tahsilat olamaz.
  const transactionId = useRef(newTransactionId());

  useEffect(() => {
    if (!modals.payment) return;
    void loadDirectories();
    // Okunamayan mod kapalı sayılır: kart tahsilatı olağan yoldan sürer.
    invokeIPC<boolean>('get_test_pos_mode', { tenantId: sessionArgs().tenantId })
      .then(setTestMode)
      .catch(() => setTestMode(false));
  }, [modals.payment, loadDirectories]);

  // Vardiya kapalıyken önce vardiya penceresi açılır; iki pencere üst üste binmez.
  if (!modals.payment || !activeShift?.isOpen) return null;

  // Sunucu indirimi yalnız kalanı kapatan tahsilatta kabul eder; bu yüzden tam hesapta durur.
  const discountCents = splitMode === 'FULL' ? parseCents(discountText) ?? 0 : 0;
  const approvedDiscountCents = discountToken ? discountCents : 0;

  let payNowCents = 0;
  if (splitMode === 'FULL') {
    payNowCents = remainingCents - approvedDiscountCents;
  } else if (splitMode === 'ITEMS') {
    payNowCents = payableItems.reduce(
      (sum, item) => sum + unitShareCents(item, selectedItemQuantities[item.id] || 0),
      0,
    );
  } else {
    payNowCents = Math.min(remainingCents, parseCents(customPartial) ?? 0);
  }

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
    setDiscountText('');
    setDiscountToken(null);
    setSelectedItemQuantities({});
    setCustomPartial('');
    setTendered('');
    setSplitMode('FULL');
    setIsUnresolved(false);
    setErrorMsg(null);
    await Promise.all([loadActiveOrder(), loadFloorPlan(), loadShiftData()]);
    closeModal('payment');
    openModal('receiptPreview');
  };

  // Çekim tahsilattan önce yapılır. Aynı işlem kimliğiyle yeniden deneme sağlayıcıya
  // gitmez, önceki sonucu alır; reddedilen kimlik bir daha kullanılmaz.
  const chargeTestPos = async (): Promise<boolean> => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    const result = await invokeIPC<{ status: string; message?: string | null }>('test_pos_charge', {
      actorRole,
      actorId,
      tenantId,
      input: { transactionId: transactionId.current, orderId: activeOrderId, amountCents: payNowCents, scenario: testScenario },
    });
    if (result.status === 'APPROVED') return true;
    // Onay jetonu işlem kimliğine bağlıdır; yeni kimlikle yeniden onay gerekir.
    transactionId.current = newTransactionId();
    setDiscountToken(null);
    setErrorMsg(`Kart tahsilatı alınmadı. ${result.message ?? ''}`.trim());
    return false;
  };

  const usesTestPos = testMode && channel === 'CARD';

  const execute = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      if (usesTestPos && !(await chargeTestPos())) return;
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
          globalDiscount: approvedDiscountCents > 0 ? { value: approvedDiscountCents } : undefined,
          approvalToken: discountToken ?? undefined,
        },
      });
      await finishSale((tenderedCents ?? payNowCents) - payNowCents, reply.remainingCents ?? 0);
    } catch (caught) {
      const message = errorText(caught);
      if (message.startsWith('IDEMPOTENCY_CONFLICT')) {
        await checkOutcome();
      } else if (DEFINITE_REJECTION.test(message)) {
        setErrorMsg(syncErrorText(message, 'tahsilat yapılmadı, para alınmadı'));
        // Satış kaydedilmedi: onaylanan çekim açıkta kalmaz. Yeni deneme yeni kimlik alır.
        if (usesTestPos) {
          await invokeIPC('test_pos_void', { actorRole, tenantId, transactionId: transactionId.current }).catch(() => undefined);
          transactionId.current = newTransactionId();
          setDiscountToken(null);
        }
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
      maxWidth="5xl"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="space-y-4 min-w-0">
        <OrderStatusBanner />
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--bg-subtle)] rounded-md p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Adisyonun Kalan Bakiyesi</span>
            <span className="text-2xl font-extrabold tabular-nums mt-0.5 block">
              {balance ? formatMoney(remainingCents) : 'Okunamadı'}
            </span>
          </div>
          <div className="bg-[var(--bg-subtle)] rounded-md p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Şu An Tahsil Edilecek</span>
            <span className="hand text-4xl leading-none tabular-nums mt-1 block">
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

        {splitMode === 'FULL' ? (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="payment-discount" className="block text-xs font-medium text-[var(--text-secondary)]">
                İndirim (₺)
              </label>
              <Input
                id="payment-discount"
                inputMode="decimal"
                value={discountText}
                disabled={isUnresolved}
                onChange={(e) => {
                  setDiscountText(e.target.value);
                  setDiscountToken(null);
                }}
                placeholder="Yok"
                className="min-h-12 tabular-nums"
              />
            </div>
            <Button
              variant="secondary"
              size="md"
              className="min-h-12"
              disabled={discountToken !== null || discountCents <= 0 || discountCents >= remainingCents}
              onClick={() => setAskDiscountPin(true)}
            >
              {discountToken ? 'İndirim Onaylandı' : 'Onaya Gönder'}
            </Button>
          </div>
        ) : null}

        {splitMode !== 'ITEMS' ? (
          <div className="ruled rounded-md bg-[var(--bg-card)] px-3 max-h-64 overflow-y-auto">
            {payableItems.map((item) => (
              <div key={item.id} className="hand h-12 grid grid-cols-[28px_minmax(0,1fr)_auto] gap-1.5 items-end pb-1 text-2xl leading-tight">
                <span className="tabular-nums">{item.quantity}</span>
                <span className="truncate">{item.name}</span>
                <span className="tabular-nums">{formatMoney(item.totalCents).replace(' ₺', '')}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-3 min-w-0">
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

        {usesTestPos ? (
          <label className="block space-y-1 rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-soft)] p-3 text-xs font-semibold text-[var(--text-primary)]">
            <span>Test POS: gerçek para çekilmez</span>
            <select
              aria-label="Test POS yanıtı"
              className="min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm"
              value={testScenario}
              onChange={(event) => setTestScenario(event.target.value as TestScenario)}
            >
              {TEST_SCENARIOS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        ) : null}

        {isUnresolved ? (
          <Button variant="primary" size="xl" onClick={() => void checkOutcome()} isLoading={isProcessing} className="w-full mt-2 text-base font-bold">
            Tahsilat Sonucunu Sorgula
          </Button>
        ) : (
          <Button variant="success" size="xl" onClick={handleExecutePayment} isLoading={isProcessing} className="w-full">
            <Check className="w-5 h-5" />
            <span>{formatMoney(payNowCents)} Tahsil Et</span>
          </Button>
        )}
      </div>
      </div>
      {askDiscountPin ? (
        <ManagerPinPrompt
          title="İndirim Onayı"
          scope={{
            operation: 'DISCOUNT',
            resourceId: transactionId.current,
            amountCents: discountCents,
            discountPercent: Math.floor((discountCents * 100 + Math.floor(remainingCents / 2)) / remainingCents),
          }}
          onApproved={(token) => {
            setDiscountToken(token);
            setAskDiscountPin(false);
          }}
          onClose={() => setAskDiscountPin(false)}
        />
      ) : null}
    </Modal>
  );
};
