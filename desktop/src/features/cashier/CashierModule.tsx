import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Printer } from 'lucide-react';
import { useShiftStore } from '../../stores/shiftStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { Button } from '../../ui/Button';
import { BlindCloseModal } from './BlindCloseModal';
import { CashExpenseModal } from './CashExpenseModal';
import { CashMovementModal } from './CashMovementModal';
import { ReceiptsTab } from './ReceiptsTab';
import { ShiftOverview } from './ShiftOverview';

/** Okunamayan tutar sıfır gösterilmez: kasa farkı sanılır. */
const money = (cents?: number | null) => (cents == null ? 'Okunamadı' : formatMoney(cents));

export const CashierModule: React.FC = () => {
  const { activeShift, summary, lastZReport, loadShiftData, recordCashMovement, closeDay } = useShiftStore();
  const canCloseDay = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');
  const [dayCloseNotice, setDayCloseNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { openModal } = useUIStore();

  const [activeTab, setActiveTab] = useState<'SHIFT' | 'RECEIPTS' | 'DAY_CLOSE'>('SHIFT');
  const [cashActionModal, setCashActionModal] = useState<'IN' | 'OUT' | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);

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
      {/* Üst Bar */}
      <div className="px-5 pt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 shrink-0 border-b-2 border-[var(--border)]">
        <div className="flex items-center gap-6" role="group" aria-label="Kasa bölümü">
          <button type="button" className="desk-tab text-lg" aria-pressed={activeTab === 'SHIFT'} onClick={() => setActiveTab('SHIFT')}>
            Vardiya
          </button>

          <button type="button" className="desk-tab text-lg" aria-pressed={activeTab === 'RECEIPTS'} onClick={() => setActiveTab('RECEIPTS')}>
            Fişler ve İade
          </button>

          <button type="button" className="desk-tab text-lg" aria-pressed={activeTab === 'DAY_CLOSE'} onClick={() => setActiveTab('DAY_CLOSE')}>
            Gün Sonu
          </button>
        </div>

        <div className="flex items-center gap-2 pb-2">
          {isShiftOpen ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setCashActionModal('IN')}>
                <ArrowDownRight className="w-4 h-4 mr-1" />
                <span>Para Girişi</span>
              </Button>

              <Button variant="secondary" size="sm" onClick={() => setCashActionModal('OUT')}>
                <ArrowUpRight className="w-4 h-4 mr-1" />
                <span>Para Çıkışı</span>
              </Button>

              {canCloseDay ? (
                <Button variant="secondary" size="sm" onClick={() => setExpenseOpen(true)} className="min-h-12 text-xs font-bold">
                  <span>Gider Öde</span>
                </Button>
              ) : null}

              <Button
                variant="primary"
                size="sm"
                onClick={() => openModal('blindClose')}
                className="min-h-12 text-xs font-bold"
              >
                <Lock className="w-4 h-4 mr-1" />
                <span>Vardiyayı Kapat</span>
              </Button>
            </>
          ) : (
            <Button
              variant="success"
              size="sm"
              onClick={() => openModal('shiftGate')}
              className="min-h-12 text-xs font-bold"
            >
              Vardiya Başlat
            </Button>
          )}
        </div>
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {activeTab === 'SHIFT' && !isShiftOpen ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md">
              <h2 className="auth-title !text-5xl">Vardiya kapalı.</h2>
              <p className="mt-3 text-lg text-[var(--text-secondary)]">Satış almak için çekmecedeki nakdi sayıp vardiyayı açın.</p>
              <Button variant="primary" size="lg" className="mt-6" onClick={() => openModal('shiftGate')}>
                Vardiyayı Aç
              </Button>
            </div>
          </div>
        ) : activeTab === 'SHIFT' ? (
          summary ? (
            <ShiftOverview summary={summary} />
          ) : (
            <p role="alert" className="text-[var(--accent-red)] font-semibold">Vardiya özeti okunamadı. Kasa ekranını yeniden açın.</p>
          )
        ) : activeTab === 'RECEIPTS' ? (
          <ReceiptsTab onRefunded={() => void loadShiftData()} />
        ) : (
          /* Gün Sonu / Z Raporu Sekmesi */
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5 items-start">
            <div className="paper receipt-paper p-6 text-sm space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-gray-400">
                <div className="font-bold text-base">KASAM360 GÜN SONU RAPORU</div>
                <div className="font-bold mt-1">
                  {lastZReport ? 'Gün sonu raporu (kapanış)' : 'Gün sonu raporu (ön izleme)'}
                </div>
                <div className="text-xs text-gray-600">
                  {lastZReport?.tenantName ?? ''} · Rapor No: {lastZReport?.reportNumber ?? 'Ön izleme'} · Tarih: {formatDateTime(lastZReport?.closedAt)}
                </div>
              </div>

              <div className="space-y-1.5 py-2 border-b border-dashed border-gray-400">
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
                    <div className="flex justify-between"><span>KDV:</span><span className="font-bold tabular-nums">{formatMoney(lastZReport.totalVatCents)}</span></div>
                    <div className="flex justify-between"><span>Adisyon:</span><span className="font-bold tabular-nums">{lastZReport.orderCount}</span></div>
                    <div className="flex justify-between pt-1 border-t border-gray-300">
                      <span>Sayılan Kasa Nakiti:</span>
                      <span className="font-bold tabular-nums">{formatMoney(lastZReport.countedCashCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Kasa Farkı:</span>
                      <span
                        className={`font-bold tabular-nums ${
                          lastZReport.differenceCents === 0
                            ? 'text-emerald-700'
                            : lastZReport.differenceCents > 0
                            ? 'text-blue-700'
                            : 'text-red-700'
                        }`}
                      >
                        {lastZReport.differenceCents === 0 ? '0,00 ₺' : formatMoney(lastZReport.differenceCents)}
                      </span>
                    </div>
                  </>
                ) : null}
                <div className="flex justify-between pt-1 border-t border-gray-300 font-bold">
                  <span>GENEL GÜNLÜK CİRO:</span>
                  <span className="text-base tabular-nums">
                    {money(lastZReport?.totalRevenueCents ?? summary?.totalSalesCents)}
                  </span>
                </div>
              </div>

              <div className="text-center pt-1 text-xs text-gray-500">
                Bilgi amaçlıdır, mali belge değildir.
              </div>
            </div>

            <section className="paper p-5 space-y-3">
              <h2 className="print-title text-2xl">Gün Sonu</h2>
              <p className="text-[var(--text-secondary)]">
                Açık masalar kapatılıp vardiya sayımı yapıldığında Z raporu üretilir.
              </p>
              {canCloseDay ? (
                <Button variant="danger" size="lg" className="w-full" onClick={() => void handleCloseDay()}>
                  Günü Kapat
                </Button>
              ) : null}
              <Button variant="secondary" size="lg" className="w-full" onClick={() => void handlePrintZ()} disabled={!lastZReport}>
                <Printer className="w-4 h-4 mr-1.5" />
                <span>Son Z Raporunu Yazdır</span>
              </Button>
              {dayCloseNotice ? (
                <p role="alert" className={`text-sm font-semibold ${dayCloseNotice.ok ? 'text-[var(--accent-emerald)]' : 'text-[var(--accent-red)]'}`}>
                  {dayCloseNotice.text}
                </p>
              ) : null}
            </section>
          </div>
        )}
      </div>

      {/* Kör Sayım Modalı */}
      <BlindCloseModal />

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
