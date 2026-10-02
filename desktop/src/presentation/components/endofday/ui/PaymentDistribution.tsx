import React from 'react';
import { CreditCard } from 'lucide-react';
import { formatCurrency } from '../helpers';

export interface PaymentPercentages {
  cashPct: number;
  cardPct: number;
  otherPct: number;
  hasData: boolean;
}

interface PaymentDistributionProps {
  totalRevenue: number;
  cashTotal: number;
  cardTotal: number;
  otherTotal: number;
  percentages: PaymentPercentages;
}

// Nakit / kart / diğer dağılımı: orantılı bar + detay kartları
export const PaymentDistribution: React.FC<PaymentDistributionProps> = ({
  totalRevenue,
  cashTotal,
  cardTotal,
  otherTotal,
  percentages,
}) => {
  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <CreditCard size={18} />
          </div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">
            Ödeme Dağılımı (Nakit vs Kart)
          </h2>
        </div>
        <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">
          Toplam: {formatCurrency(totalRevenue)}
        </span>
      </div>

      <div className="w-full dark:bg-white/[0.06] bg-black/[0.05] rounded-full h-3.5 p-0.5 flex overflow-hidden border dark:border-white/10 border-black/[0.08] mb-4">
        {percentages.hasData ? (
          <>
            {percentages.cashPct > 0 && (
              <div
                className="bg-emerald-500 h-full rounded-l-full transition-all duration-500"
                style={{ width: `${percentages.cashPct}%` }}
                title={`Nakit: %${percentages.cashPct}`}
              />
            )}
            {percentages.cardPct > 0 && (
              <div
                className={`bg-[#007AFF] h-full transition-all duration-500 ${
                  percentages.cashPct === 0 ? 'rounded-l-full' : ''
                } ${percentages.otherPct === 0 ? 'rounded-r-full' : ''}`}
                style={{ width: `${percentages.cardPct}%` }}
                title={`Kredi Kartı / POS: %${percentages.cardPct}`}
              />
            )}
            {percentages.otherPct > 0 && (
              <div
                className="bg-purple-500 h-full rounded-r-full transition-all duration-500"
                style={{ width: `${percentages.otherPct}%` }}
                title={`Diğer: %${percentages.otherPct}`}
              />
            )}
          </>
        ) : (
          <div className="w-full dark:bg-white/[0.02] bg-black/[0.02] h-full rounded-full flex items-center justify-center text-[10px] dark:text-zinc-500 text-zinc-400">
            Henüz gün içi satış verisi oluşmadı
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <div>
              <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Fiziki Nakit</p>
              <p className="text-xs dark:text-zinc-500 text-zinc-500">%{percentages.cashPct}</p>
            </div>
          </div>
          <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
            {formatCurrency(cashTotal)}
          </span>
        </div>

        <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shrink-0" />
            <div>
              <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Kredi Kartı / POS</p>
              <p className="text-xs dark:text-zinc-500 text-zinc-500">%{percentages.cardPct}</p>
            </div>
          </div>
          <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
            {formatCurrency(cardTotal)}
          </span>
        </div>

        {otherTotal > 0 && (
          <div className="p-4 rounded-2xl dark:bg-white/[0.03] bg-white/60 backdrop-blur-md border dark:border-white/5 border-black/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
              <div>
                <p className="text-xs font-medium dark:text-zinc-300 text-zinc-700">Diğer / Yemek Kartı</p>
                <p className="text-xs dark:text-zinc-500 text-zinc-500">%{percentages.otherPct}</p>
              </div>
            </div>
            <span className="text-sm font-semibold dark:text-white text-zinc-900 font-mono">
              {formatCurrency(otherTotal)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentDistribution;
