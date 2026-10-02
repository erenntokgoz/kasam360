import React from 'react';
import { Layers, User, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDateTime, getExpectedCents, getActualCents, getDifferenceCents, getCashierName, getOpenedAt } from '../helpers';
import type { ShiftRow } from '../types';
import { MutabakatBadge } from './MutabakatBadge';

interface ShiftBoardProps {
  rows: ShiftRow[];
  openShiftCount: number;
}

// Kasa & Vardiya çizelgesi: açılış devri, nakit tahsilat, hareket, sayım ve mutabakat
export const ShiftBoard: React.FC<ShiftBoardProps> = ({ rows, openShiftCount }) => {
  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-amber-600 dark:text-amber-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <Layers size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold dark:text-white text-zinc-900">Kasa & Vardiya Çizelgesi</h2>
            <p className="text-xs dark:text-zinc-400 text-zinc-500">
              Kasiyer Kasa Takibi &bull; Açılış devri, nakit tahsilatlar, hareketler, sayım ve mutabakat
            </p>
          </div>
        </div>
        <span className="text-xs">
          {openShiftCount > 0 ? (
            <span className="text-amber-600 dark:text-amber-300 font-medium px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/25">
              {openShiftCount} Aktif Açık Kasa
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-300 font-medium px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25">
              Tüm Kasalar Kapalı
            </span>
          )}
        </span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border dark:border-white/10 border-black/[0.06]">
          <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
            <thead className="dark:bg-white/[0.03] bg-black/[0.02] text-[11px] font-semibold uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
              <tr>
                <th className="px-4 py-3.5">Kasiyer / Vardiya</th>
                <th className="px-4 py-3.5">Açılış Bakiyesi</th>
                <th className="px-4 py-3.5">Nakit Tahsilat</th>
                <th className="px-4 py-3.5">Nakit Giriş/Çıkış</th>
                <th className="px-4 py-3.5">Beklenen Kasa</th>
                <th className="px-4 py-3.5">Fiili Sayım</th>
                <th className="px-4 py-3.5 text-right">Kasa Farkı Uyarısı</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
              {rows.map((row) => {
                const { shift, isOpen } = row;
                const expected = getExpectedCents(shift);
                const opening = 'openingBalance' in shift && typeof shift.openingBalance === 'number'
                  ? shift.openingBalance
                  : null;
                const cashIn = 'cashInCents' in shift && typeof shift.cashInCents === 'number' ? shift.cashInCents : 0;
                const cashOut = 'cashOutCents' in shift && typeof shift.cashOutCents === 'number' ? shift.cashOutCents : 0;
                const movementNet = cashIn - cashOut;
                const actual = isOpen ? null : getActualCents(shift as never);
                const diff = isOpen ? null : getDifferenceCents(shift as never);

                return (
                  <tr key={shift.id} className="hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div
                          className={`p-1.5 rounded-xl border ${
                            isOpen
                              ? 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          <User size={14} />
                        </div>
                        <div>
                          <div className="font-semibold dark:text-white text-zinc-900 flex items-center gap-1.5">
                            <span>{getCashierName(shift)}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded-full text-[9px] font-semibold border ${
                                isOpen
                                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/30'
                                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                              }`}
                            >
                              {isOpen ? 'AÇIK' : 'KAPANDI'}
                            </span>
                          </div>
                          <div className="text-[10px] dark:text-zinc-500 text-zinc-400 font-mono">
                            #{shift.id.slice(0, 8)} &bull; {formatDateTime(getOpenedAt(shift))}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* AGENTS.md: bilinmeyen devir tutarı uydurulmaz, "Bilinmiyor" yazılır */}
                    <td className="px-4 py-3.5 whitespace-nowrap font-mono text-zinc-700 dark:text-zinc-300">
                      <div>{opening === null ? 'Bilinmiyor' : formatCurrency(opening)}</div>
                      <div className="text-[10px] text-zinc-400">Devir Tutarı</div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                      <div>{row.cashSalesCents === null ? 'Bilinmiyor' : `+${formatCurrency(row.cashSalesCents)}`}</div>
                      <div className="text-[10px] text-zinc-400">Satış Tahsilatı</div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap font-mono text-zinc-600 dark:text-zinc-400">
                      <div>
                        {movementNet >= 0
                          ? `+${formatCurrency(movementNet)}`
                          : `-${formatCurrency(Math.abs(movementNet))}`}
                      </div>
                      <div className="text-[10px] text-zinc-400">Kasa Hareketi</div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap font-mono font-semibold dark:text-zinc-200 text-zinc-800">
                      <div>{formatCurrency(expected)}</div>
                      <div className="text-[10px] text-zinc-400">Devir+Satış±Hareket</div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap font-mono font-bold dark:text-white text-zinc-900">
                      {isOpen ? (
                        <span className="dark:text-zinc-500 text-zinc-400 font-sans text-xs italic">
                          Sayım Bekleniyor
                        </span>
                      ) : actual !== null ? (
                        formatCurrency(actual)
                      ) : (
                        formatCurrency(expected)
                      )}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-right">
                      <MutabakatBadge status={isOpen ? 'OPEN' : 'CLOSED'} diff={diff} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] text-center">
          <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium dark:text-zinc-300 text-zinc-700">
            Bugüne ait açık veya kapanmış vardiya kaydı bulunmuyor.
          </p>
          <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">
            Kasiyerler vardiya açıp sayım yaptıkça kasa mutabakatları bu çizelgede anlık güncellenir.
          </p>
        </div>
      )}
    </div>
  );
};

export default ShiftBoard;
