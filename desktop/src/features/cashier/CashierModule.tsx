import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Printer, Clock } from 'lucide-react';
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
import { CashMovementModal } from './CashMovementModal';
import { ReceiptsTab } from './ReceiptsTab';

/** Okunamayan tutar sıfır gösterilmez: kasa farkı sanılır. */
const money = (cents?: number | null) => (cents == null ? 'Okunamadı' : formatMoney(cents));

export const CashierModule: React.FC = () => {
  const { activeShift, summary, lastZReport, loadShiftData, recordCashMovement, closeDay } = useShiftStore();
  const canCloseDay = useAuthStore((state) => state.user?.role === 'OWNER' || state.user?.role === 'MANAGER');
  const [dayCloseNotice, setDayCloseNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { openModal } = useUIStore();

  const [activeTab, setActiveTab] = useState<'SHIFT' | 'RECEIPTS' | 'DAY_CLOSE'>('SHIFT');
  const [cashActionModal, setCashActionModal] = useState<'IN' | 'OUT' | null>(null);

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
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <Button
            variant={activeTab === 'SHIFT' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('SHIFT')}
            className="min-h-12 text-xs font-bold"
          >
            Aktif Vardiya ve Kasa
          </Button>

          <Button
            variant={activeTab === 'RECEIPTS' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('RECEIPTS')}
            className="min-h-12 text-xs font-bold"
          >
            Fişler ve İade
          </Button>

          <Button
            variant={activeTab === 'DAY_CLOSE' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('DAY_CLOSE')}
            className="min-h-12 text-xs font-bold"
          >
            Gün Sonu (Z Raporu)
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {isShiftOpen ? (
            <>
              <Button
                variant="outline-emerald"
                size="sm"
                onClick={() => setCashActionModal('IN')}
                className="min-h-12 text-xs font-bold"
              >
                <ArrowDownRight className="w-4 h-4 mr-1" />
                <span>+ Nakit Giriş</span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCashActionModal('OUT')}
                className="min-h-12 text-xs font-bold text-[var(--accent-red)] border-[var(--accent-red-border)] hover:bg-[var(--accent-red-soft)]"
              >
                <ArrowUpRight className="w-4 h-4 mr-1" />
                <span>− Nakit Çıkış</span>
              </Button>

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
        {activeTab === 'SHIFT' ? (
          <>
            {/* Üst Kartlar: Çekmece Nakiti ve Satış Dağılımı */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[var(--bg-panel)] border border-[var(--accent-emerald-border)] rounded-xl p-4 shadow-sm">
                <span className="text-xs text-[var(--text-secondary)] block">Kasa Çekmecesindeki Nakit</span>
                <span className="text-2xl font-bold text-[var(--accent-emerald)] tabular-nums mt-1 block">
                  {money(summary?.expectedCashInDrawerCents)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
                  Açılış: {money(summary?.openingCashCents)}
                </span>
              </div>

              <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
                <span className="text-xs text-[var(--text-secondary)] block">Toplam Vardiya Cirosu</span>
                <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums mt-1 block">
                  {summary ? formatMoney(summary.totalSalesCents) : 'Okunamadı'}
                </span>
              </div>

              <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
                <span className="text-xs text-[var(--text-secondary)] block">Vardiya Sorumlusu</span>
                <span className="text-xl font-bold text-[var(--text-primary)] mt-1 block truncate">
                  {summary?.cashierName ?? 'Okunamadı'}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 mt-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Açılış: {formatDateTime(summary?.openedAt)}</span>
                </span>
              </div>
            </div>

            {/* Tahsilat Kanalları Dökümü */}
            <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Ödeme Kanalları Dökümü
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Nakit Tahsilat</span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
                    {money(summary?.totalCashSalesCents)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Kredi Kartı</span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
                    {money(summary?.totalCardSalesCents)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Yemek Kartları</span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
                    {money(summary?.totalMealCardSalesCents)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Veresiye (Cari)</span>
                  <span className="text-base font-bold text-[var(--accent-amber)] tabular-nums mt-0.5 block">
                    {money(summary?.totalVeresiyeCents)}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : activeTab === 'RECEIPTS' ? (
          <ReceiptsTab onRefunded={() => void loadShiftData()} />
        ) : (
          /* Gün Sonu / Z Raporu Sekmesi */
          <div className="max-w-2xl bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">Gün Sonu Kapanışı (Z Raporu)</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Tüm açık masalar kapatıldığında ve vardiya sayımı yapıldığında Z Raporu üretilir.
                </p>
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

            <div className="receipt-paper p-5 rounded-lg border text-xs space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-gray-400">
                <div className="font-bold text-sm">KASAM360 GÜN SONU RAPORU</div>
                <div className="font-bold text-xs mt-1">
                  {lastZReport ? 'GÜN SONU MALİ Z RAPORU (KAPANIŞ)' : 'GÜN SONU MALİ Z RAPORU (CANLI ÖNİZLEME)'}
                </div>
                <div className="text-[10px] text-gray-600">
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
                        {lastZReport.differenceCents === 0 ? '0,00 ₺ (Kusursuz)' : formatMoney(lastZReport.differenceCents)}
                      </span>
                    </div>
                  </>
                ) : null}
                <div className="flex justify-between pt-1 border-t border-gray-300 font-bold">
                  <span>GENEL GÜNLÜK CİRO:</span>
                  <span className="text-sm tabular-nums">
                    {money(lastZReport?.totalRevenueCents ?? summary?.totalSalesCents)}
                  </span>
                </div>
              </div>

              <div className="text-center pt-1 text-[10px] text-gray-500">
                Mali mühür SHA-256 zinciriyle denetim defterine işlenmiştir.
              </div>
            </div>

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
      <BlindCloseModal />

      {/* Nakit Giriş / Çıkış Modalı */}
      <CashMovementModal
        isOpen={cashActionModal !== null}
        type={cashActionModal}
        onClose={() => setCashActionModal(null)}
        onSubmit={handleCashMovementSubmit}
      />
    </section>
  );
};
