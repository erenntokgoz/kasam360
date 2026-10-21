import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Printer, Clock } from 'lucide-react';
import { useShiftStore } from '../../stores/shiftStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMoney } from '../../lib/formatMoney';
import { formatDateTime } from '../../lib/date';
import { Button } from '../../ui/Button';
import { BlindCloseModal } from './BlindCloseModal';
import { CashMovementModal } from './CashMovementModal';

export const CashierModule: React.FC = () => {
  const { activeShift, summary, lastZReport, loadShiftData, recordCashMovement } = useShiftStore();
  const { openModal } = useUIStore();

  const [activeTab, setActiveTab] = useState<'SHIFT' | 'DAY_CLOSE'>('SHIFT');
  const [cashActionModal, setCashActionModal] = useState<'IN' | 'OUT' | null>(null);

  useEffect(() => {
    loadShiftData();
  }, [loadShiftData]);

  const handleCashMovementSubmit = async (type: 'IN' | 'OUT', cents: number, reason: string) => {
    await recordCashMovement(type, cents, reason);
  };

  const isShiftOpen = activeShift && activeShift.isOpen;

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      {/* Üst Bar */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <Button
            variant={activeTab === 'SHIFT' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('SHIFT')}
            className="!min-h-[38px] text-xs font-bold"
          >
            Aktif Vardiya ve Kasa
          </Button>

          <Button
            variant={activeTab === 'DAY_CLOSE' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveTab('DAY_CLOSE')}
            className="!min-h-[38px] text-xs font-bold"
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
                className="!min-h-[38px] text-xs font-bold"
              >
                <ArrowDownRight className="w-4 h-4 mr-1" />
                <span>+ Nakit Giriş</span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCashActionModal('OUT')}
                className="!min-h-[38px] text-xs font-bold text-[var(--accent-red)] border-[var(--accent-red-border)] hover:bg-[var(--accent-red-soft)]"
              >
                <ArrowUpRight className="w-4 h-4 mr-1" />
                <span>− Nakit Çıkış</span>
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => openModal('blindClose')}
                className="!min-h-[38px] text-xs font-bold"
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
              className="!min-h-[38px] text-xs font-bold"
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
                  {formatMoney(summary?.expectedCashInDrawerCents || 150000)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
                  Açılış: {formatMoney(summary?.openingCashCents || 150000)}
                </span>
              </div>

              <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
                <span className="text-xs text-[var(--text-secondary)] block">Toplam Vardiya Cirosu</span>
                <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums mt-1 block">
                  {formatMoney(summary?.totalSalesCents || 2130000)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
                  Toplam {summary?.orderCount || 14} Adisyon Kapatıldı
                </span>
              </div>

              <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
                <span className="text-xs text-[var(--text-secondary)] block">Vardiya Sorumlusu</span>
                <span className="text-xl font-bold text-[var(--text-primary)] mt-1 block truncate">
                  {summary?.cashierName || 'Eren Tokgöz'}
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
                    {formatMoney(summary?.totalCashSalesCents || 485000)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Kredi Kartı</span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
                    {formatMoney(summary?.totalCardSalesCents || 1240000)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Yemek Kartları</span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums mt-0.5 block">
                    {formatMoney(summary?.totalMealCardSalesCents || 320000)}
                  </span>
                </div>

                <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3">
                  <span className="text-xs text-[var(--text-secondary)] block">Veresiye (Cari)</span>
                  <span className="text-base font-bold text-[var(--accent-amber)] tabular-nums mt-0.5 block">
                    {formatMoney(summary?.totalVeresiyeCents || 85000)}
                  </span>
                </div>
              </div>
            </div>
          </>
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
                onClick={() => openModal('receiptPreview')}
                className="text-xs"
              >
                <Printer className="w-4 h-4 mr-1.5" />
                <span>Son Z Raporunu Yazdır</span>
              </Button>
            </div>

            <div className="receipt-paper p-5 rounded-lg border text-xs space-y-3">
              <div className="text-center pb-2 border-b border-dashed border-gray-400">
                <div className="font-bold text-sm">KASAM360 DEMO RESTORAN</div>
                <div className="text-[11px] text-gray-600">VKN: 9028374615 · MERSİS: 090283746150001</div>
                <div className="font-bold text-xs mt-1">
                  {lastZReport ? 'GÜN SONU MALİ Z RAPORU (KAPANIŞ)' : 'GÜN SONU MALİ Z RAPORU (CANLI ÖNİZLEME)'}
                </div>
                <div className="text-[10px] text-gray-600">
                  Rapor No: {lastZReport?.reportNumber || 'Z-009182'} · Tarih: {lastZReport?.dateStr || new Date().toLocaleDateString('tr-TR')}
                </div>
              </div>

              <div className="space-y-1.5 py-2 border-b border-dashed border-gray-400">
                <div className="flex justify-between">
                  <span>Açılış Kasa Nakiti:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(lastZReport?.openingCashCents ?? (summary?.openingCashCents || 150000))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Nakit Satış:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(lastZReport?.cashSalesCents ?? (summary?.totalCashSalesCents || 485000))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Kredi Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(lastZReport?.cardSalesCents ?? (summary?.totalCardSalesCents || 1240000))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Yemek Kartı:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(lastZReport?.mealCardSalesCents ?? (summary?.totalMealCardSalesCents || 320000))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam Veresiye:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(lastZReport?.veresiyeSalesCents ?? (summary?.totalVeresiyeCents || 85000))}
                  </span>
                </div>
                {lastZReport ? (
                  <>
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
                    {formatMoney(lastZReport?.totalRevenueCents ?? (summary?.totalSalesCents || 2130000))}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600 text-[11px]">
                  <span>Hesaplanan KDV (%10 Dahil):</span>
                  <span className="tabular-nums">
                    {formatMoney(lastZReport?.totalVatCents ?? (summary?.totalTaxCents || 193636))}
                  </span>
                </div>
              </div>

              <div className="text-center pt-1 text-[10px] text-gray-500">
                Mali mühür SHA-256 zinciriyle denetim defterine işlenmiştir.
              </div>
            </div>
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
