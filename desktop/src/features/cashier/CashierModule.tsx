import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { formatNumber } from '../../lib/numberText';
import { useShiftStore } from '../../stores/shiftStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { Button } from '../../ui/Button';
import { BlindCloseModal } from './BlindCloseModal';
import { CashExpenseModal } from './CashExpenseModal';
import { CashMovementModal } from './CashMovementModal';
import { FinanceTab } from '../patron/finance/FinanceTab';
import { useLedgerStore } from '../../stores/ledgerStore';
import { ReceiptsTab } from './ReceiptsTab';
import { ShiftHistory } from './ShiftHistory';
import { ShiftMovements } from './ShiftMovements';

/** Okunamayan tutar sıfır gösterilmez: kasa farkı sanılır. */
const money = (cents?: number | null) => (cents == null ? '—' : formatMoney(cents));

export const CashierModule: React.FC = () => {
  const { activeShift, summary, lastZReport, loadShiftData, recordCashMovement, closeDay } = useShiftStore();
  const canCloseDay = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');
  // Kör sayım: kasiyer çekmecede olması gereken tutarı ve onu türeten toplamları görmez.
  const isBlind = useAuthStore((state) => state.user?.role === 'CASHIER');
  const [dayCloseNotice, setDayCloseNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const openModal = useUIStore((state) => state.openModal);

  const [activeTab, setActiveTab] = useState<'SHIFT' | 'FINANCE' | 'RECEIPTS' | 'DAY_CLOSE'>('SHIFT');
  const financeAsked = useLedgerStore((state) => state.activeErpTab === 'FINANCE');
  const [cashActionModal, setCashActionModal] = useState<'IN' | 'OUT' | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);

  useEffect(() => {
    if (!financeAsked) return;
    setActiveTab('SHIFT');
    useLedgerStore.getState().setActiveErpTab('PANORAMA');
  }, [financeAsked, canCloseDay]);

  useEffect(() => {
    loadShiftData();
  }, [loadShiftData]);

  const handleCashMovementSubmit = async (type: 'IN' | 'OUT', cents: number, reason: string) => {
    await recordCashMovement(type, cents, reason);
  };

  const isShiftOpen = activeShift && activeShift.isOpen;

  const handlePrintZ = async () => {
    if (!lastZReport) return;
    try {
      const { actorRole, tenantId } = sessionArgs();
      await invokeIPC('print_z_report', { shiftId: lastZReport.shiftId, actorRole, tenantId });
      window.print();
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
              <BarAction onClick={() => setCashActionModal('IN')}>Nakit Giriş</BarAction>
              <BarAction onClick={() => setCashActionModal('OUT')}>Nakit Çıkış</BarAction>
              {canCloseDay ? <BarAction onClick={() => setExpenseOpen(true)}>Gider Öde</BarAction> : null}
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
      <div className="page-fill flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'SHIFT' && !isShiftOpen ? (
          <div className="paper border border-[var(--border)] rounded-xl p-4 shadow-sm flex flex-col items-start gap-4">
            <h2 className="print-title text-sm font-bold">Vardiya açık değil</h2>
            <Button variant="primary" className="min-h-12" onClick={() => openModal('shiftGate')}>Vardiya Başlat</Button>
          </div>
        ) : activeTab === 'SHIFT' ? (
          <>
            <div className="paper border border-[var(--border)] rounded-xl p-4 shadow-sm flex flex-wrap gap-x-10 gap-y-3">
              {[
                ...(isBlind
                  ? []
                  : [
                      ['Çekmecedeki Nakit', money(summary?.expectedCashInDrawerCents)],
                      ['Ciro', money(summary?.totalSalesCents)],
                      ['Nakit', money(summary?.totalCashSalesCents)],
                    ]),
                ['Kart', money(summary?.totalCardSalesCents)],
                ['Yemek Kartı', money(summary?.totalMealCardSalesCents)],
                ['Veresiye', money(summary?.totalVeresiyeCents)],
                ['Sorumlu', summary?.cashierName ?? '—'],
              ].map(([label, value]) => (
                <span key={label}>
                  <span className="block text-xs text-[var(--text-secondary)]">{label}</span>
                  <span className="block text-lg font-bold tabular-nums">{value}</span>
                </span>
              ))}
            </div>
            {summary ? <ShiftMovements summary={summary} blind={isBlind} /> : null}
            {canCloseDay ? <FinanceTab /> : null}
          </>
        ) : activeTab === 'RECEIPTS' ? (
          <ReceiptsTab onRefunded={() => void loadShiftData()} />
        ) : (
          /* Gün Sonu / Z Raporu Sekmesi */
          <div className="paper border border-[var(--border)] rounded-xl p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <div>
                <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Gün Sonu Kapanışı (Z Raporu)</h2>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handlePrintZ()}
                disabled={!lastZReport}
                className="text-xs"
              >
                <Printer className="w-4 h-4 mr-1.5" />
                <span>Son Z Raporunu Yazdır</span>
              </Button>
            </div>

            <div className="receipt-paper text-sm space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-[var(--border-strong)]">
                <div className="font-bold text-sm">{lastZReport?.tenantName || 'Gün Sonu Raporu'}</div>
                <div className="font-bold text-xs mt-1">
                  {lastZReport ? 'Gün sonu raporu (kapanış)' : 'Gün sonu raporu (ön izleme)'}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Rapor No: {lastZReport?.reportNumber ?? 'Ön izleme'} · Tarih: {formatDateTime(lastZReport?.closedAt)}
                  {lastZReport?.cashierName ? ` · Kasiyer: ${lastZReport.cashierName}` : ''}
                </div>
              </div>

              <div className="space-y-1.5 py-2 border-b border-dashed border-[var(--border-strong)]">
                <div className="flex justify-between">
                  <span>Açılış Kasa Nakiti:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport?.openingCashCents ?? summary?.openingCashCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Nakit Satış:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport?.cashSalesCents ?? summary?.totalCashSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Kredi Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport?.cardSalesCents ?? summary?.totalCardSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Yemek Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport?.mealCardSalesCents ?? summary?.totalMealCardSalesCents)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Veresiye:</span>
                  <span className="font-bold tabular-nums">
                    {money(lastZReport?.veresiyeSalesCents ?? summary?.totalVeresiyeCents)}
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
                    {money(lastZReport?.totalRevenueCents ?? summary?.totalSalesCents)}
                  </span>
                </div>
              </div>

              <div className="text-center pt-1 text-xs text-[var(--text-muted)]">
                Bilgi amaçlıdır, mali belge değildir.
              </div>
            </div>

            {canCloseDay ? <ShiftHistory /> : null}
            {canCloseDay ? (
              <Button variant="danger" className="w-full min-h-12" onClick={() => void handleCloseDay()}>
                Günü Kapat
              </Button>
            ) : null}
            {dayCloseNotice ? (
              <p role="alert" className={`text-xs font-semibold ${dayCloseNotice.ok ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-red)]'}`}>
                {dayCloseNotice.text}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Kör Sayım Modalı */}
      <BlindCloseModal onShowZ={() => setActiveTab('DAY_CLOSE')} />

      {/* Nakit Giriş / Çıkış Modalı */}
      <CashMovementModal
        isOpen={cashActionModal !== null}
        type={cashActionModal}
        onClose={() => setCashActionModal(null)}
        onSubmit={handleCashMovementSubmit}
      />
      {expenseOpen ? (
        <CashExpenseModal
          onClose={() => setExpenseOpen(false)}
          onSaved={() => {
            setExpenseOpen(false);
            void loadShiftData();
          }}
        />
      ) : null}
    </section>
  );
};
