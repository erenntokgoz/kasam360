import React from 'react';
import { TrendingUp, CreditCard, Banknote, Receipt } from 'lucide-react';
import { formatCurrency } from '../helpers';

interface ScoreCardsProps {
  totalRevenue: number;
  totalOrders: number;
  cashTotal: number;
  cardTotal: number;
  averageOrderCents: number;
}

// 4 net skor kartı: Günlük Ciro / Fiziki Nakit Kasa / Kredi Kartı-POS / Adisyon
export const ScoreCards: React.FC<ScoreCardsProps> = ({
  totalRevenue,
  totalOrders,
  cashTotal,
  cardTotal,
  averageOrderCents,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
            Günlük Ciro
          </p>
          <p className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono">
            {formatCurrency(totalRevenue)}
          </p>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Günlük Net Ciro (Hasılat)</p>
        </div>
        <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-emerald-600 dark:text-emerald-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
          <TrendingUp size={24} />
        </div>
      </div>

      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
            Fiziki Nakit Kasa
          </p>
          <p className="text-2xl md:text-3xl font-semibold tracking-tight text-amber-600 dark:text-amber-300 font-mono">
            {formatCurrency(cashTotal)}
          </p>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Fiziki nakit çekmecesi</p>
        </div>
        <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-amber-600 dark:text-amber-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
          <Banknote size={24} />
        </div>
      </div>

      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
            Kredi Kartı / POS
          </p>
          <p className="text-2xl md:text-3xl font-semibold tracking-tight text-[#007AFF] dark:text-blue-300 font-mono">
            {formatCurrency(cardTotal)}
          </p>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">Banka ve slip tahsilatı</p>
        </div>
        <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
          <CreditCard size={24} />
        </div>
      </div>

      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl transition-all hover:border-black/[0.12] dark:hover:border-white/20 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-1">
            Adisyon Sayısı
          </p>
          <p className="text-2xl md:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 font-mono">
            {totalOrders} <span className="text-sm font-normal dark:text-zinc-400 text-zinc-500">Adet</span>
          </p>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1">
            Toplam Adisyon Sayısı &bull; Ort. {formatCurrency(averageOrderCents)}
          </p>
        </div>
        <div className="p-3.5 dark:bg-white/[0.06] bg-black/[0.04] text-purple-600 dark:text-purple-400 rounded-2xl border dark:border-white/10 border-black/[0.08] shadow-inner">
          <Receipt size={24} />
        </div>
      </div>
    </div>
  );
};

export default ScoreCards;
