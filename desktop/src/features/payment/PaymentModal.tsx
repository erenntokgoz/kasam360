import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, AlertCircle, HandCoins } from 'lucide-react';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useLedgerStore } from '../../stores/ledgerStore';
import { useFloorStore } from '../../stores/floorStore';
import { useShiftStore } from '../../stores/shiftStore';
import { sessionArgs } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import { centsToText, parseCents } from '../../lib/moneyInput';
import { planPayment } from '../../lib/paymentMath';
import { unitShareCents } from '../../lib/orderMath';
import { errorText } from '../../lib/cariInput';
import { syncErrorText } from '../../lib/syncError';
import { invokeIPC } from '../../services/tauriClient';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { NumberInput } from '../../ui/NumberInput';
import { PaymentItemSplitTab } from './PaymentItemSplitTab';
import { PaymentChannelSection } from './PaymentChannelSection';
import { OrderStatusBanner } from '../pos/OrderStatusBanner';
import { TIP_METHOD_LABEL, TipDialog } from './TipDialog';
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

export const PaymentModal: React.FC = () => {
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);
  const openModal = useUIStore((state) => state.openModal);
  const { activeTableName, activeTableId, activeOrderId, balance, ticketItems, loadActiveOrder, setLastSale } = usePosStore();
  const { directories, createContact, loadDirectories } = useLedgerStore();
  const { loadFloorPlan } = useFloorStore();
  const { activeShift, loadShiftData } = useShiftStore();

  const remainingCents = balance?.remainingCents ?? 0;
  const payableItems = useMemo(() => ticketItems.filter((item) => item.isSentToKitchen), [ticketItems]);

  const [splitMode, setSplitMode] = useState<PaymentSplitMode>('FULL');
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Record<string, number>>({});
  const [partialText, setPartialText] = useState('');
  const [channel, setChannel] = useState<PaymentMethod>('CASH');
  const [receivedText, setReceivedText] = useState('');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnresolved, setIsUnresolved] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testScenario, setTestScenario] = useState<TestScenario>('APPROVE');
  const [isTipOpen, setIsTipOpen] = useState(false);
  const [tipNotice, setTipNotice] = useState<string | null>(null);

  // Aynı niyet aynı kimlikle gider: yeniden deneme ikinci tahsilat olamaz.
  const transactionId = useRef(newTransactionId());

  // Sekme veya yöntem değişince eski giriş kalmaz: önceki tutar yeni hesabı bozmasın.
  const clearEntry = () => {
    setSelectedItemQuantities({});
    setPartialText('');
    setReceivedText('');
    setErrorMsg(null);
  };

  useEffect(() => {
    if (!modals.payment) return;
    clearEntry();
    setSplitMode('FULL');
    setChannel('CASH');
    setTipNotice(null);
    void loadDirectories();
    // Okunamayan mod kapalı sayılır: kart tahsilatı olağan yoldan sürer.
    invokeIPC<boolean>('get_test_pos_mode', { tenantId: sessionArgs().tenantId })
      .then(setTestMode)
      .catch(() => setTestMode(false));
  }, [modals.payment, loadDirectories]);

  // Vardiya kapalıyken önce vardiya penceresi açılır; iki pencere üst üste binmez.
  if (!modals.payment || !activeShift?.isOpen) return null;

  const plan = planPayment({
    mode: splitMode,
    remainingCents,
    itemsCents: payableItems.reduce((sum, item) => sum + unitShareCents(item, selectedItemQuantities[item.id] || 0), 0),
    partialCents: partialText ? parseCents(partialText) : null,
    receivedCents: receivedText ? parseCents(receivedText) : null,
    isCash: channel === 'CASH',
  });
  const payNowCents = plan.dueCents;

  const pinpadInfo = [
    { label: 'Masa', value: activeTableName },
    { label: 'Kalan Bakiye', value: formatMoney(remainingCents) },
    { label: 'Tahsil Edilecek', value: formatMoney(payNowCents) },
  ];

  const toggleItemSelect = (itemId: string, maxQty: number) => {
    setErrorMsg(null);
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

  const finishSale = async (remaining: number) => {
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
      receivedCents: plan.receivedCents,
      changeCents: plan.changeCents,
      remainingCents: remaining,
    });
    transactionId.current = newTransactionId();
    clearEntry();
    setSplitMode('FULL');
    setIsUnresolved(false);
    await Promise.all([loadActiveOrder(), loadFloorPlan(), loadShiftData()]);
    closeModal('payment');
    openModal('receiptPreview');
    useUIStore.getState().showNotice('Tahsilat kaydedildi.');
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
    transactionId.current = newTransactionId();
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
          amountTendered: plan.receivedCents,
          totalAmount: payNowCents,
          changeAmount: plan.changeCents,
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
        },
      });
      await finishSale(reply.remainingCents ?? 0);
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
        await finishSale(status.balance.remainingCents);
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
      setErrorMsg(splitMode === 'ITEMS' ? 'Ödenecek kalemleri seçin.' : 'Tahsil edilecek tutarı girin.');
    } else if (plan.exceedsRemaining) {
      setErrorMsg('Tutar kalan bakiyeden büyük olamaz.');
    } else if (channel === 'VERESIYE' && !selectedDirectoryId) {
      setErrorMsg('Cari müşteri seçin.');
    } else if (plan.shortCents > 0 && splitMode === 'FULL' && plan.receivedCents > 0) {
      // Müşteri nakdin bir kısmını verdi: alınan nakit parça ödeme olarak hazırlanır,
      // girilen tutar silinmez; kalan için yöntem seçilir.
      setSplitMode('PARTIAL');
      setPartialText(receivedText);
      setErrorMsg(`${formatMoney(plan.receivedCents)} nakit alınacak, ${formatMoney(plan.shortCents)} masada kalacak. Onaylamak için yeniden basın.`);
    } else if (plan.shortCents > 0) {
      setErrorMsg(`${formatMoney(plan.shortCents)} eksik.`);
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
      surface="work"
      maxWidth="5xl"

    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="space-y-4 min-w-0">
          <OrderStatusBanner />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-subtle)] rounded-lg p-4">
              <span className="text-sm text-[var(--text-secondary)] block">Kalan Bakiye</span>
              <span className="text-2xl font-extrabold tabular-nums mt-0.5 block">
                {balance ? formatMoney(remainingCents) : 'Okunamadı'}
              </span>
            </div>
            <div className="bg-[var(--bg-subtle)] rounded-lg p-4">
              <span className="text-sm text-[var(--text-secondary)] block">Şu An Tahsil Edilecek</span>
              <span className="text-2xl font-extrabold tabular-nums mt-0.5 block text-[var(--accent-blue)]">
                {formatMoney(payNowCents)}
              </span>
            </div>
          </div>

          {plan.leftCents > 0 && payNowCents > 0 ? (
            <p className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold tabular-nums">
              Bu ödemeden sonra masada {formatMoney(plan.leftCents)} kalır.
            </p>
          ) : null}

          <Button variant="secondary" className="w-full justify-start" disabled={isProcessing || isUnresolved} onClick={() => setIsTipOpen(true)}>
            <HandCoins className="w-5 h-5" />
            Bahşiş Gir
          </Button>
          {tipNotice ? (
            <p role="status" className="rounded-lg bg-[var(--accent-emerald-soft)] px-4 py-3 text-sm font-semibold">{tipNotice}</p>
          ) : null}

          {errorMsg ? (
            <div role="alert" className="p-4 rounded-lg text-sm font-semibold text-center break-words bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)] flex items-center justify-center gap-1.5">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            {SPLIT_TABS.map(({ mode, label }) => (
              <Button
                key={mode}
                disabled={isUnresolved}
                variant={splitMode === mode ? 'selected' : 'ghost'}
                onClick={() => {
                  clearEntry();
                  setSplitMode(mode);
                }}
              >
                {label}
              </Button>
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
              <label htmlFor="payment-partial" className="block text-sm font-semibold text-[var(--text-secondary)]">
                Tahsil Edilecek Tutar (₺)
              </label>
              <div className="flex gap-2">
                <NumberInput
                  id="payment-partial"
                  aria-label="Tahsil Edilecek Tutar"
                  value={partialText}
                  onValueChange={(text) => {
                    setPartialText(text);
                    setErrorMsg(null);
                  }}
                  placeholder="Tutar"
                  className="flex-1"
                  pinpadTitle="Tahsil Edilecek Tutar"
                  pinpadInfo={pinpadInfo.slice(0, 2)}
                />
                <Button variant="secondary" className="shrink-0" onClick={() => setPartialText(centsToText(Math.ceil(remainingCents / 2)))}>
                  1/2 Hesap
                </Button>
              </div>
            </div>
          ) : null}

          {splitMode !== 'ITEMS' ? (
            <div className="rounded-lg bg-[var(--bg-card)] border border-[var(--border)] divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
              {payableItems.map((item) => (
                <div key={item.id} className="min-h-11 px-3 grid grid-cols-[32px_minmax(0,1fr)_auto] gap-1.5 items-center text-sm">
                  <span className="font-bold tabular-nums">{item.quantity}</span>
                  <span className="truncate">{item.name}</span>
                  <span className="font-bold tabular-nums">{formatMoney(item.totalCents)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4 min-w-0">
          <PaymentChannelSection
            channel={channel}
            onSelectChannel={(next) => {
              setChannel(next);
              setReceivedText('');
              setErrorMsg(null);
            }}
            plan={plan}
            receivedText={receivedText}
            onChangeReceived={(text) => {
              setReceivedText(text);
              setErrorMsg(null);
            }}
            pinpadInfo={pinpadInfo}
            directories={directories}
            selectedDirectoryId={selectedDirectoryId}
            onSelectDirectory={setSelectedDirectoryId}
            onCreateContact={handleCreateCari}
          />

          {usesTestPos ? (
            <label className="block space-y-2 rounded-lg border border-[var(--accent-amber-border)] bg-[var(--accent-amber-soft)] p-4 text-sm font-semibold text-[var(--text-primary)]">
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
            <Button variant="primary" size="xl" onClick={() => void checkOutcome()} isLoading={isProcessing} className="w-full">
              Tahsilat Sonucunu Sorgula
            </Button>
          ) : (
            <Button variant="success" size="xl" onClick={handleExecutePayment} isLoading={isProcessing} disabled={payNowCents <= 0} className="w-full">
              <Check className="w-5 h-5" />
              <span>{formatMoney(payNowCents)} Tahsil Et</span>
            </Button>
          )}
        </div>
      </div>
      {isTipOpen ? (
        <TipDialog
          info={pinpadInfo.slice(0, 2)}
          onSaved={(cents, method, recipient) => {
            setIsTipOpen(false);
            setTipNotice(`${formatMoney(cents)} bahşiş kaydedildi · ${recipient ?? 'Ortak Havuz'} · ${TIP_METHOD_LABEL[method]}`);
          }}
          onClose={() => setIsTipOpen(false)}
        />
      ) : null}
    </Modal>
  );
};
