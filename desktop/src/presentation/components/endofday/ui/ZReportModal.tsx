import React from 'react';
import { X, Printer } from 'lucide-react';
import { formatCurrency, formatDateTime, getClosedAt, getOpenedAt, getExpectedCents, getActualCents, getDifferenceCents, getCashierName } from '../helpers';
import type { ShiftHistoryDto } from '../types';

interface ZReportModalProps {
  shift: ShiftHistoryDto | null;
  tenantId: string;
  actorName: string;
  actorRole: string;
  totalOrders: number;
  totalRevenue: number;
  cashTotal: number;
  cardTotal: number;
  otherTotal: number;
  isPrinting: boolean;
  onClose: () => void;
  onPrint: (shift: ShiftHistoryDto | null) => void;
}

// Mali Z-raporu önizleme: vardiya veya gün bazlı termal fiş görünümü
export const ZReportModal: React.FC<ZReportModalProps> = ({
  shift,
  tenantId,
  actorName,
  actorRole,
  totalOrders,
  totalRevenue,
  cashTotal,
  cardTotal,
  otherTotal,
  isPrinting,
  onClose,
  onPrint,
}) => {
  const actualCents = shift ? getActualCents(shift) : null;
  const expectedCents = shift ? getExpectedCents(shift) : 0;
  const diff = shift ? getDifferenceCents(shift) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center dark:bg-black/85 bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="backdrop-blur-2xl dark:bg-[#060609]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] max-w-md w-full rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
          <div>
            <h3 className="text-base font-semibold dark:text-white text-zinc-900">Mali Z-Raporu Önizleme</h3>
            <p className="text-xs dark:text-zinc-400 text-zinc-500">
              {shift ? `Vardiya Z-Raporu: ${shift.id.slice(0, 8)}` : 'Günün Hesap Defteri Mali Belgesi'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="bg-white text-zinc-900 font-mono text-xs p-6 rounded-2xl shadow-2xl border border-zinc-200 space-y-3">
            <div className="text-center space-y-1 pb-3 border-b-2 border-dashed border-zinc-300">
              <p className="text-base font-black tracking-wider">KASAM360 POS SİSTEMİ</p>
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-700">
                {shift ? 'VARDİYA MALİ Z-RAPORU' : 'GÜNÜN HESAP DEFTERİ MALİ Z-RAPORU'}
              </p>
              <p className="text-[11px] text-zinc-500">Şube: {tenantId}</p>
              <p className="text-[11px] text-zinc-500">
                Yetkili: {shift ? getCashierName(shift) : actorName} ({actorRole})
              </p>
            </div>

            <div className="py-2 space-y-1 border-b border-dashed border-zinc-200 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-600">Rapor Tarihi:</span>
                <span className="font-semibold">
                  {formatDateTime(shift ? getClosedAt(shift) || getOpenedAt(shift) : new Date().toISOString())}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Z-Rapor No:</span>
                <span className="font-semibold font-mono">
                  {shift
                    ? `Z-VARD-${shift.id.slice(0, 8).toUpperCase()}`
                    : `Z-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`}
                </span>
              </div>
            </div>

            {shift ? (
              <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                  --- VARDİYA VE KASA MUTABAKATI ---
                </p>
                <div className="flex justify-between">
                  <span className="text-zinc-700">Açılış Zamanı:</span>
                  <span className="font-medium">{formatDateTime(getOpenedAt(shift))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700">Kapanış Zamanı:</span>
                  <span className="font-medium">{formatDateTime(getClosedAt(shift) || 'Açık')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700">Açılış Kasası:</span>
                  <span className="font-bold">{formatCurrency(expectedCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-700">Sayılan / Kapanış Kasası:</span>
                  <span className="font-bold">{formatCurrency(actualCents ?? expectedCents)}</span>
                </div>
                <div className="flex justify-between text-sm font-black pt-1 border-t border-zinc-200">
                  <span>KASA FARKI (FARK):</span>
                  <span className={diff ? 'text-amber-700 font-bold' : 'text-emerald-700'}>
                    {diff ? formatCurrency(diff) : '0,00 TL (Kasa Denk)'}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                  <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                    --- SATIŞ VE CİRO ÖZETİ ---
                  </p>
                  <div className="flex justify-between">
                    <span className="text-zinc-700">Toplam Adisyon / Fiş:</span>
                    <span className="font-bold">{totalOrders} Adet</span>
                  </div>
                  <div className="flex justify-between text-sm font-black pt-1 border-t border-zinc-200">
                    <span>GÜNLÜK NET CİRO:</span>
                    <span>{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>

                <div className="py-2 space-y-1.5 border-b border-dashed border-zinc-200">
                  <p className="font-bold text-center text-zinc-800 text-[11px] tracking-wide mb-1">
                    --- ÖDEME DAĞILIMI ---
                  </p>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-700">Fiziki Nakit Kasası:</span>
                    <span className="font-bold">{formatCurrency(cashTotal)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-700">Kredi Kartı / POS:</span>
                    <span className="font-bold">{formatCurrency(cardTotal)}</span>
                  </div>
                  {otherTotal > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-700">Diğer / Yemek Kartı:</span>
                      <span className="font-bold">{formatCurrency(otherTotal)}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="pt-2 text-center space-y-0.5 text-[9px] text-zinc-500">
              <p className="font-bold tracking-wider">MALİ DEĞERİ YOKTUR - BİLGİ AMAÇLIDIR</p>
              <p>Kasam360 Bulut Entegre Restoran Çözümleri</p>
              <p className="text-[9px] text-emerald-700 font-bold">
                *** {shift ? 'VARDİYA RAPORU ONAYLANDI' : 'HESAP DEFTERİ ONAYLANDI VE MÜHÜRLENDİ'} ***
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between p-5 border-t dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.01]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.1] hover:bg-black/[0.08] dark:text-zinc-200 text-zinc-700 transition-all cursor-pointer"
          >
            Kapat
          </button>

          <button
            type="button"
            onClick={() => onPrint(shift)}
            disabled={isPrinting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] border dark:border-white/15 border-black/10 dark:text-white text-zinc-900 shadow-md backdrop-blur-xl transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            <Printer size={15} className={isPrinting ? 'animate-bounce text-zinc-400' : ''} />
            <span>{isPrinting ? 'Yazdırılıyor...' : 'Termal Yazıcıya Gönder'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZReportModal;
