import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Printer, ReceiptText } from 'lucide-react';
import { formatNumber } from '../../lib/numberText';
import { useShiftStore } from '../../stores/shiftStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import type { ZReportData } from '../../types/shift';
import { Modal } from '../../ui/Modal';
import { formatDateTime } from '../../lib/date';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { Button } from '../../ui/Button';
import { BlindCloseModal } from './BlindCloseModal';
import { CashExpenseForm } from './CashExpenseForm';
import { CashMovementForm } from './CashMovementForm';
import { FinanceTab } from '../patron/finance/FinanceTab';
import { useLedgerStore } from '../../stores/ledgerStore';
import { ReceiptsTab } from './ReceiptsTab';
import { ShiftHistory } from './ShiftHistory';
import { ShiftMovements } from './ShiftMovements';
import { ShiftTotals } from './ShiftTotals';

/** Okunamayan tutar sıfır gösterilmez: kasa farkı sanılır. */
const money = (cents?: number | null) => (cents == null ? '—' : formatMoney(cents));

const CASH_ACTIONS = [
  { id: 'IN', label: 'Nakit Giriş', title: 'Kasaya Nakit Girişi', icon: ArrowDownLeft },
  { id: 'OUT', label: 'Nakit Çıkış', title: 'Kasadan Nakit Çıkışı', icon: ArrowUpRight },
  { id: 'EXPENSE', label: 'Gider Öde', title: 'Kasadan Gider Öde', icon: ReceiptText },
] as const;

type CashAction = (typeof CASH_ACTIONS)[number]['id'];

export const CashierModule: React.FC = () => {
  const { activeShift, summary, lastZReport: latestReport, isLoading, shiftError, loadShiftData, recordCashMovement, closeDay } = useShiftStore();
  const role = useAuthStore((state) => state.user?.role);
  const isOwner = role === 'OWNER';
  const canStartCashAction = isOwner || role === 'CASHIER' || role === 'MANAGER';
  const canRecordCashMovement = isOwner || role === 'CASHIER';
  const canCloseDay = isOwner || role === 'MANAGER';
  // Kör sayım: kasiyer çekmecede olması gereken tutarı ve onu türeten toplamları görmez.
  const isBlind = useAuthStore((state) => state.user?.role === 'CASHIER');
  const [selectedReport, setSelectedReport] = useState<ZReportData | null>(null);
  const lastZReport = selectedReport ?? latestReport;
  const [dayCloseNotice, setDayCloseNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const openModal = useUIStore((state) => state.openModal);

  const [activeTab, setActiveTab] = useState<'SHIFT' | 'FINANCE' | 'RECEIPTS' | 'DAY_CLOSE'>('SHIFT');
  const financeAsked = useLedgerStore((state) => state.activeErpTab === 'FINANCE');
  const [cashAction, setCashAction] = useState<CashAction | 'CHOOSE' | null>(null);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [isActionUncertain, setIsActionUncertain] = useState(false);
  const [showExpenses, setShowExpenses] = useState(false);

  useEffect(() => {
    if (!financeAsked) return;
    setActiveTab('SHIFT');
    if (canCloseDay) setShowExpenses(true);
    useLedgerStore.getState().setActiveErpTab('PANORAMA');
  }, [financeAsked, canCloseDay]);

  useEffect(() => {
    loadShiftData();
  }, [loadShiftData]);

  const handleCashMovementSubmit = async (type: 'IN' | 'OUT', cents: number, reason: string, movementId: string, approvalToken?: string) => {
    await recordCashMovement(type, cents, reason, movementId, approvalToken);
  };

  const closeCashAction = () => { if (!isActionBusy && !isActionUncertain) setCashAction(null); };
  const currentAction = CASH_ACTIONS.find((action) => action.id === cashAction);

  const isShiftOpen = activeShift?.isOpen === true;
  const canShowReport = !!lastZReport && (!isBlind || !isShiftOpen);

  const handleSelectReport = async (shiftId: string) => {
    setDayCloseNotice(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      const report = await invokeIPC<ZReportData>('get_z_report', { shiftId, actorRole, tenantId });
      setSelectedReport(report);
    } catch (caught) {
      setDayCloseNotice({ ok: false, text: errorText(caught) });
    }
  };

  const handleCloseDay = async () => {
    try {
      setDayCloseNotice({ ok: true, text: await closeDay() });
    } catch (caught) {
      setDayCloseNotice({ ok: false, text: errorText(caught) });
    }
  };

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      <Bar
        label="Kasa"
        actions={
          isShiftOpen ? (
            <>
              {canStartCashAction ? <BarAction onClick={() => setCashAction('CHOOSE')}>İşlem Ekle</BarAction> : null}
              <BarAction tone="primary" onClick={() => openModal('blindClose')}>Vardiyayı Kapat</BarAction>
            </>
          ) : undefined
        }
      >
        <BarTab active={activeTab === 'SHIFT'} onClick={() => setActiveTab('SHIFT')}>Defter</BarTab>
        <BarTab active={activeTab === 'RECEIPTS'} onClick={() => setActiveTab('RECEIPTS')}>Fişler</BarTab>
        <BarTab active={activeTab === 'DAY_CLOSE'} onClick={() => setActiveTab('DAY_CLOSE')}>Gün Sonu</BarTab>
      </Bar>

      {/* İçerik */}
      <div className="motion-swap page-fill flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'SHIFT' ? (
          <>
            <div className="work-surface rounded-lg border border-[var(--border)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">
                  {shiftError ? 'Vardiya Durumu Okunamadı' : isLoading ? 'Vardiya Yükleniyor' : isShiftOpen ? 'Vardiya Açık' : 'Vardiya Kapalı'}
                </h2>
                {isShiftOpen && <p className="text-sm tabular-nums text-[var(--text-secondary)]">
                  {activeShift.cashierName} · {formatDateTime(activeShift.openedAt)}
                </p>}
                {!isShiftOpen && !isLoading && !shiftError && latestReport && !isBlind ? (
                  <p className="text-sm tabular-nums text-[var(--text-secondary)]">
                    Son kapanış {formatDateTime(latestReport.closedAt)} · Fark {formatMoney(latestReport.differenceCents)}
                  </p>
                ) : null}
                {shiftError && <ErrorToast message={errorText(shiftError)} />}
              </div>
              {shiftError ? <Button onClick={() => void loadShiftData()}>Tekrar Dene</Button> : null}
              {!isShiftOpen && !isLoading && !shiftError ? (
                <Button variant="primary" onClick={() => openModal('shiftGate')}>Vardiya Başlat</Button>
              ) : null}
            </div>
            {summary ? <ShiftMovements summary={summary} blind={isBlind} /> : null}
            {summary ? <ShiftTotals summary={summary} blind={isBlind} /> : null}
            {!isShiftOpen && !isLoading && !shiftError && canCloseDay ? (
              <section className="work-surface rounded-lg border border-[var(--border)] p-4">
                <ShiftHistory key={latestReport?.shiftId} onSelect={(id) => { void handleSelectReport(id).then(() => setActiveTab('DAY_CLOSE')); }} />
              </section>
            ) : null}
            {canCloseDay ? (
              <details className="work-surface rounded-lg border border-[var(--border)]" open={showExpenses}
                onToggle={(event) => setShowExpenses(event.currentTarget.open)}>
                <summary className="min-h-12 cursor-pointer px-4 py-3 font-semibold">Dönem Giderleri</summary>
                {showExpenses ? <div className="p-3"><FinanceTab /></div> : null}
              </details>
            ) : null}
          </>
        ) : activeTab === 'RECEIPTS' ? (
          <ReceiptsTab onRefunded={() => void loadShiftData()} />
        ) : (
          /* Gün Sonu / Z Raporu Sekmesi */
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <section className="work-surface space-y-4 rounded-lg border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <h2 className="print-title text-base font-bold text-[var(--text-primary)]">Z Raporu</h2>
              <Button variant="primary" onClick={() => window.print()} disabled={!canShowReport}>
                <Printer className="w-4 h-4" aria-hidden="true" />
                <span>Yazdır</span>
              </Button>
            </div>

            {canShowReport ? <div className="receipt-paper text-sm space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-[var(--border-strong)]">
                <div className="font-bold text-sm">{lastZReport?.tenantName || 'Gün Sonu Raporu'}</div>
                <div className="font-bold text-xs mt-1">
                  Gün sonu raporu (kapanış)
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Rapor No: {lastZReport.reportNumber} · Tarih: {formatDateTime(lastZReport?.closedAt)}
                  {lastZReport?.cashierName ? ` · Kasiyer: ${lastZReport.cashierName}` : ''}
                </div>
              </div>

              <div className="space-y-1.5 py-2 border-b border-dashed border-[var(--border-strong)]">
                <div className="flex justify-between">
                  <span>Açılış Kasa Nakiti:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport.openingCashCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Nakit Satış:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport.cashSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Kredi Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport.cardSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Yemek Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport.mealCardSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Veresiye:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport.veresiyeSalesCents)}
                  </span>
                </div>
                {lastZReport ? (
                  <>
                    <div className="flex justify-between"><span>İndirim:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.discountTotalCents)}</span></div>
                    <div className="flex justify-between"><span>İptal:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.voidTotalCents)}</span></div>
                    <div className="flex justify-between"><span>İade:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.refundTotalCents)}</span></div>
                    <div className="flex justify-between"><span>İkram:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.compTotalCents)}</span></div>
                    <div className="flex justify-between"><span>Kasa Girişleri:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.cashInCents)}</span></div>
                    <div className="flex justify-between"><span>Kasa Çıkışları ve Giderler:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.cashOutCents)}</span></div>
                    <div className="flex justify-between"><span>KDV:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.totalVatCents)}</span></div>
                    <div className="flex justify-between"><span>Adisyon:</span><span className="font-bold tabular-nums">{formatNumber(lastZReport.orderCount)}</span></div>
                    <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                      <span>Kasada Olması Gereken:</span>
                      <span className="font-bold tabular-nums">{formatMoney(lastZReport.expectedCashCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sayılan Kasa Nakiti:</span>
                      <span className="font-bold tabular-nums">{formatMoney(lastZReport.countedCashCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Kasa Farkı:</span>
                      <span
                        className={`font-bold tabular-nums ${
                          lastZReport.differenceCents === 0
                            ? 'text-[var(--accent-emerald)]'
                            : lastZReport.differenceCents > 0
                            ? 'text-[var(--accent-blue)]'
                            : 'text-[var(--accent-red)]'
                        }`}
                      >
                        {lastZReport.differenceCents === 0 ? '0,00 ₺ (Kusursuz)' : formatMoney(lastZReport.differenceCents)}
                      </span>
                    </div>
                  </>
                ) : null}
                <div className="flex justify-between pt-1 border-t border-[var(--border)] font-bold">
                  <span>GENEL GÜNLÜK CİRO:</span>
                  <span className="text-sm tabular-nums">
                    {money(lastZReport.totalRevenueCents)}
                  </span>
                </div>
              </div>

              <div className="text-center pt-1 text-xs text-[var(--text-muted)]">
                Bilgi amaçlıdır, mali belge değildir.
              </div>
            </div> : <p className="text-sm text-[var(--text-secondary)]">Kapanmış vardiya raporu yok.</p>}
          </section>

          {canCloseDay ? (
            <section className="work-surface space-y-4 rounded-lg border border-[var(--border)] p-4">
              <ShiftHistory key={latestReport?.shiftId} onSelect={(id) => void handleSelectReport(id)} />
              <div className="flex justify-end border-t border-[var(--border)] pt-4">
                <Button variant="danger" onClick={() => void handleCloseDay()}>Günü Kapat</Button>
              </div>
              {dayCloseNotice?.ok ? <p role="status" className="text-sm font-semibold text-[var(--accent-emerald)]">{dayCloseNotice.text}</p> : null}
            </section>
          ) : null}
          <ErrorToast message={dayCloseNotice && !dayCloseNotice.ok ? dayCloseNotice.text : null} />
          </div>
        )}
      </div>

      {/* Kör Sayım Modalı */}
      <BlindCloseModal onShowZ={() => { setSelectedReport(null); setActiveTab('DAY_CLOSE'); }} />

      <Modal cardFlow isOpen={cashAction !== null && isShiftOpen && canStartCashAction}
        title={currentAction?.title ?? 'İşlem Ekle'} onClose={closeCashAction} maxWidth="sm">
        {cashAction === 'CHOOSE' ? (
          <div className="grid gap-2">
            {CASH_ACTIONS.filter((action) => isOwner || (action.id === 'IN' && role === 'CASHIER') || (action.id === 'OUT' && role === 'MANAGER')).map(({ id, label, icon: Icon }) => (
              <Button key={id} type="button" className="!justify-start" onClick={() => { setIsActionUncertain(false); setCashAction(id); }}>
                <Icon size={18} aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
        ) : cashAction === 'EXPENSE' && isOwner ? (
          <CashExpenseForm busy={isActionBusy} setBusy={setIsActionBusy} onBack={() => setCashAction('CHOOSE')}
            onSaved={() => { setCashAction(null); void loadShiftData(); }} />
        ) : (cashAction === 'IN' && canRecordCashMovement) || (cashAction === 'OUT' && (isOwner || role === 'MANAGER')) ? (
          <CashMovementForm type={cashAction} busy={isActionBusy} setBusy={setIsActionBusy}
            uncertain={isActionUncertain} setUncertain={setIsActionUncertain}
            onBack={() => { setIsActionUncertain(false); setCashAction('CHOOSE'); }}
            onSaved={() => { setIsActionUncertain(false); setCashAction(null); }} onSubmit={handleCashMovementSubmit} />
        ) : null}
      </Modal>
    </section>
  );
};
