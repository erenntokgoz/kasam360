import React, { useCallback, useEffect, useState } from 'react';
import { Scale, Loader2 } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { formatCurrency } from '../helpers';

// get_net_balance yaniti (backend/src/ledger_commands/net_balance.rs)
export interface NetBalancePosition {
  accountClass: string;
  label: string;
  badge: string;
  directoryId: string;
  directoryName: string;
  receivableCents: number;
  payableCents: number;
  ownerWithdrawalCents: number;
  signedBalanceCents: number;
  openDebts: number;
}

export interface NetBalanceClassTotal {
  accountClass: string;
  label: string;
  badge: string;
  totalCents: number;
}

export interface NetBalanceReport {
  positions: NetBalancePosition[];
  byClass: NetBalanceClassTotal[];
  receivableCents: number;
  payableCents: number;
  ownerWithdrawalCents: number;
  netBalanceCents: number;
}

/**
 * Net bakiye şeridi. Beş hesap sütunu tek satırda toplanır.
 * AGENTS.md 3.4: tutarlar tam sayi kuruş; yuvarlama veya sessiz sifir yok.
 * AGENTS.md 4.6: rakamlar tabular-nums ile hizalanir.
 */
export const NetBalanceStrip: React.FC = () => {
  const [report, setReport] = useState<NetBalanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<NetBalanceReport>('get_net_balance', {});
      setReport(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl flex items-center gap-2 text-sm dark:text-zinc-400 text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
        <span>Net bakiye hesaplaniyor...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border border-red-500/30 rounded-3xl p-5 shadow-xl text-sm text-red-600 dark:text-red-400">
        Net bakiye alinamadi: {error ?? 'bilinmeyen hata'}
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <Scale size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold dark:text-white text-zinc-900">Net Bakiye (Tek Sayi)</h2>
            <p className="text-xs dark:text-zinc-400 text-zinc-500">
              Alacak - Borc - Sermaye Cekimi = Net; hesap sinifi kirilimi asagida
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Net Bakiye</p>
          <p
            data-testid="net-balance-total"
            className={`text-2xl font-semibold tabular-nums ${
              report.netBalanceCents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {formatCurrency(report.netBalanceCents)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] dark:text-zinc-400 text-zinc-500">Toplam Alacak</p>
          <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(report.receivableCents)}
          </p>
        </div>
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] dark:text-zinc-400 text-zinc-500">Toplam Borc</p>
          <p className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrency(report.payableCents)}
          </p>
        </div>
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] dark:text-zinc-400 text-zinc-500">Sermaye Cekimi</p>
          <p className="text-sm font-semibold tabular-nums text-purple-600 dark:text-purple-400">
            {formatCurrency(report.ownerWithdrawalCents)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {report.byClass.map((item) => {
          const isOwner = item.accountClass === 'OWNER_PERSONAL';
          return (
            <div
              key={item.accountClass}
              data-testid={`net-class-${item.accountClass}`}
              className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]"
            >
              <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">{item.badge}</p>
              <p className="text-[11px] dark:text-zinc-500 text-zinc-400 mb-1">{item.label}</p>
              {isOwner ? (
                <>
                  <p className="text-sm font-semibold tabular-nums text-purple-600 dark:text-purple-400">
                    {formatCurrency(item.totalCents)}
                  </p>
                  {/* K-4: Patron Sahsi alacak degil, sermaye cekimidir */}
                  <p className="text-[10px] dark:text-zinc-400 text-zinc-500">Sermaye Cekimi</p>
                </>
              ) : (
                <p className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900">
                  {formatCurrency(item.totalCents)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NetBalanceStrip;
