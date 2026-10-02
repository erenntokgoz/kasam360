import React from 'react';
import { Search, RefreshCw, User, FileText, Printer, Calendar } from 'lucide-react';
import { formatCurrency, formatDateTime, getClosedAt, getOpenedAt, getExpectedCents, getActualCents, getDifferenceCents, getCashierName } from '../helpers';
import type { ShiftHistoryDto } from '../types';
import { MutabakatBadge } from './MutabakatBadge';

interface ArchivePanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  rows: ShiftHistoryDto[];
  onInspect: (shift: ShiftHistoryDto) => void;
  onPrint: (shift: ShiftHistoryDto) => void;
}

// Geçmiş defter arşivi: arama + kapanış tablosu + Z-raporu/termal yazdırma aksiyonları
export const ArchivePanel: React.FC<ArchivePanelProps> = ({
  search,
  onSearchChange,
  loading,
  onRefresh,
  rows,
  onInspect,
  onPrint,
}) => {
  return (
    <div className="space-y-4">
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 p-5 rounded-3xl border dark:border-white/10 border-black/[0.08] shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 dark:text-zinc-400 text-zinc-500"
          />
          <input
            type="text"
            placeholder="Kasiyer adı veya vardiya koduna göre ara..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/10 rounded-2xl pl-10 pr-4 py-2.5 text-sm dark:text-white text-zinc-900 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-[#007AFF]/60"
          />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Arşivi Yenile</span>
        </button>
      </div>

      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 rounded-3xl border dark:border-white/10 border-black/[0.08] shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center dark:text-zinc-400 text-zinc-500">
            <RefreshCw size={28} className="animate-spin text-[#007AFF] mx-auto mb-2" />
            <p className="text-sm font-medium">Geçmiş Z-Raporları getiriliyor...</p>
          </div>
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm dark:text-zinc-300 text-zinc-700">
              <thead className="dark:bg-white/[0.03] bg-black/[0.02] text-xs font-semibold uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
                <tr>
                  <th className="px-6 py-4">Kapanış Tarihi</th>
                  <th className="px-6 py-4">Kasiyer / Yetkili</th>
                  <th className="px-6 py-4">Durum</th>
                  <th className="px-6 py-4">Açılış Kasası</th>
                  <th className="px-6 py-4">Kapanış / Sayım</th>
                  <th className="px-6 py-4">Kasa Farkı Uyarısı</th>
                  <th className="px-6 py-4 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
                {rows.map((item) => {
                  const isClosed = item.status?.toUpperCase() === 'CLOSED';
                  const diff = getDifferenceCents(item);
                  const actual = getActualCents(item);

                  return (
                    <tr key={item.id} className="hover:dark:bg-white/[0.03] hover:bg-black/[0.02] transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium dark:text-white text-zinc-900">
                          {formatDateTime(getClosedAt(item) || getOpenedAt(item))}
                        </div>
                        <div className="text-xs dark:text-zinc-500 text-zinc-500 font-mono">
                          Açılış: {formatDateTime(getOpenedAt(item))}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <User size={15} className="text-[#007AFF]" />
                          <span className="font-medium dark:text-white text-zinc-900">{getCashierName(item)}</span>
                        </div>
                        <div className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400">
                          ID: {item.id.slice(0, 8)}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {isClosed ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                            Kapandı
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                            Açık
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap font-mono dark:text-zinc-300 text-zinc-700">
                        {formatCurrency(getExpectedCents(item))}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap font-mono font-semibold dark:text-white text-zinc-900">
                        {actual !== null ? formatCurrency(actual) : '-'}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <MutabakatBadge status={item.status} diff={diff} />
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => onInspect(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 text-xs font-medium border dark:border-white/15 border-black/10 transition-colors cursor-pointer shadow-sm"
                        >
                          <FileText size={14} />
                          <span>Z-Raporu İncele</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPrint(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 text-xs font-medium border dark:border-white/15 border-black/10 transition-colors cursor-pointer shadow-sm"
                          title="Termal Fiş Tekrar Yazdır"
                        >
                          <Printer size={14} />
                          <span>Yazdır</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center dark:text-zinc-400 text-zinc-500">
            <Calendar size={36} className="dark:text-zinc-600 text-zinc-400 mx-auto mb-3" />
            <p className="text-base font-semibold dark:text-zinc-300 text-zinc-700">Geçmiş Defter Kaydı Bulunamadı</p>
            <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">
              Kapatılan gün sonu defterleri ve Z-raporları otomatik olarak burada arşivlenir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchivePanel;
