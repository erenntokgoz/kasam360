import React, { forwardRef } from 'react';
import { Calendar, RefreshCw, X } from 'lucide-react';

import {
  REPORT_RANGE_PRESETS,
  ReportRange,
  ReportRangePresetId,
  fromDateInput,
  rangeDayCount,
  toDateInputValue,
} from './reportTypes';

export interface ReportRangeBarProps {
  range: ReportRange;
  preset: ReportRangePresetId;
  onPresetChange: (preset: ReportRangePresetId) => void;
  onRangeChange: (range: ReportRange) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const inputClass =
  'rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-[#007AFF]/50 transition-colors';

/**
 * Rapor tarih filtresi.
 *
 * Neden aralık zorunlu: "tüm zamanlar" filtresiz `SELECT` demektir ve tüm
 * tenant'ın satırlarını tarar. Bu yüzden hazır aralıklar vardır ve özel
 * aralıkta iki tarih de girilmeden rapor yenilenmez.
 */
export const ReportRangeBar = forwardRef<HTMLDivElement, ReportRangeBarProps>(
  function ReportRangeBar(
    { range, preset, onPresetChange, onRangeChange, onRefresh, isRefreshing },
    ref,
  ) {
    const [rangeError, setRangeError] = React.useState<string | null>(null);
    const startValue = toDateInputValue(range.from);
    const endValue = toDateInputValue(range.to);

    const applyCustom = (start: string, end: string) => {
      const result = fromDateInput(start, end);
      if ('error' in result) {
        setRangeError(result.error);
        return;
      }
      setRangeError(null);
      onRangeChange(result);
    };

    return (
      <div
        ref={ref}
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-4 py-3 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <Calendar size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Tarih aralığı</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_RANGE_PRESETS.map((item) => {
            const active = item.id === preset;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPresetChange(item.id)}
                aria-pressed={active}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#007AFF] text-white'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="sr-only">Başlangıç tarihi</span>
              <input
                type="date"
                value={startValue}
                onChange={(event) => applyCustom(event.target.value, endValue)}
                className={inputClass}
              />
            </label>
            <span className="text-[11px] text-zinc-500">–</span>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="sr-only">Bitiş tarihi</span>
              <input
                type="date"
                value={endValue}
                onChange={(event) => applyCustom(startValue, event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        )}

        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {rangeDayCount(range)} gün
        </span>

        <div className="ml-auto flex items-center gap-2">
          {rangeError && (
            <span className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              {rangeError}
              <button
                type="button"
                onClick={() => setRangeError(null)}
                className="cursor-pointer"
                aria-label="Uyarıyı kapat"
              >
                <X size={12} />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.08] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>
    );
  },
);
