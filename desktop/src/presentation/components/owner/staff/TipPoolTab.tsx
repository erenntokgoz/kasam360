import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { Coins, Scale, TriangleAlert } from 'lucide-react';
import {
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { currentPeriod, money, shiftPeriod } from './staff360Types';
import type { StaffKpi, TipPoolSummary } from './staff360Types';

type TipAllocationRow = {
  userId: string;
  fullName: string;
  basis: string;
};

/**
 * Sekme 3 — Bahşiş Havuzu.
 *
 * Havuz dağıtımı para hareketidir: yalnız işletme sahibi dağıtabilir. Müdür
 * havuz tutarını ve dağıtım tabanlarını görür, dağıtma düğmesi kilitlidir.
 */
export function TipPoolTab() {
  const { tenantId, actorRole, toast } = useStaffContext();
  const canDistribute = actorRole === 'OWNER';

  const [period, setPeriod] = useState(currentPeriod());
  const [ozet, setOzet] = useState<TipPoolSummary | null>(null);
  const [dagitimlar, setDagitimlar] = useState<TipAllocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dagitimliyor, setDagitimliyor] = useState(false);

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const o = await invoke<TipPoolSummary>('get_tip_pool_summary', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
          period,
        });
        setOzet(o ?? null);
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Havuz özeti alınamadı.');
        setOzet(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actorRole, tenantId, period]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  /**
   * Taban önerisi: kişinin o dönemdeki fiş adedi.
   *
   * Neden fiş adedi: garson için vardiye saati kaydı tutulmaz, dolayısıyla
   * saat üzerinden dağıtım gerçek veriye dayanmaz. Yöneticinin gördüğü fiş
   * sayısı ise mevcuttur ve elle düzeltilebilir.
   */
  const tabanYukle = useCallback(async () => {
    try {
      const [baslangic, bitis] = donemAraligi(period);
      const kpi = await invoke<StaffKpi[]>('get_staff_kpi', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        from: baslangic,
        to: bitis,
      });
      setDagitimlar(
        (Array.isArray(kpi) ? kpi : [])
          .filter((k) => k.orderCount > 0 || k.itemCount > 0)
          .map((k) => ({
            userId: k.userId,
            fullName: k.fullName,
            basis: k.orderCount > 0 ? String(k.orderCount) : '',
          }))
      );
    } catch {
      setDagitimlar([]);
    }
  }, [actorRole, tenantId, period]);

  useEffect(() => {
    tabanYukle();
  }, [tabanYukle]);

  const handleDistribute = async () => {
    const allocations = dagitimlar
      .filter((d) => d.basis && Number(d.basis) > 0)
      .map((d) => ({
        userId: d.userId,
        basisCents: Math.round(Number(d.basis) * 100),
        multiplierPercent: 100,
      }));
    if (allocations.length === 0) {
      setError('Dağıtılacak taban yok. Önce dönemde fiş açan personel girin.');
      return;
    }
    setDagitimliyor(true);
    setError(null);
    try {
      await invoke('distribute_tip_pool', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        period,
        allocations,
      });
      toast({ title: `${period} bahşiş havuzu dağıtıldı.`, type: 'success' });
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Dağıtım yapılamadı.');
    } finally {
      setDagitimliyor(false);
    }
  };

  const toplamBakiye = dagitimlar.reduce(
    (t, d) => t + (Number(d.basis) > 0 ? Number(d.basis) : 0),
    0
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<Coins size={22} />}
        title="Bahşiş Havuzu"
        description="Dönemde toplanan nakit bahşiş, çalışma tabanına göre paylaştırılır."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
        actions={
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Dönem
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                onClick={() => setPeriod(shiftPeriod(period, -1))}
                aria-label="Önceki dönem"
                className="cursor-pointer rounded-2xl border border-black/10 px-2.5 py-2 text-xs text-zinc-600 hover:bg-black/[0.05] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              >
                ‹
              </button>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label="Bahşiş dönemi"
                className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
              />
              <button
                onClick={() => setPeriod(shiftPeriod(period, 1))}
                aria-label="Sonraki dönem"
                className="cursor-pointer rounded-2xl border border-black/10 px-2.5 py-2 text-xs text-zinc-600 hover:bg-black/[0.05] dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              >
                ›
              </button>
            </div>
          </label>
        }
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      {loading ? (
        <StaffLoading label="Havuz özeti yükleniyor..." />
      ) : !ozet || ozet.totalCents === 0 ? (
        <StaffEmptyState
          message="Bu dönemde kayıtlı bahşiş yok."
          hint="Kasa ekranında nakit ödeme sırasında girilen bahşiş burada toplanır."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Tile label="Havuz Toplamı" value={money(ozet.totalCents)} />
            <Tile label="Dağıtılan" value={money(ozet.distributedCents)} />
            <Tile
              label="Kalan"
              value={money(ozet.leftoverCents)}
              tone={ozet.leftoverCents === 0 ? 'ok' : 'warn'}
            />
          </div>

          {ozet.leftoverCents !== 0 && (
            <div className="flex items-start gap-2 rounded-3xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/10 px-4 py-3 text-xs text-[#FF9500] dark:text-[#FF9F0A]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <p>
                Kalan {money(ozet.leftoverCents)} dağıtılmadı. Kuruş kaybı olmaması
                için dağıtım toplamı havuza birebir eşit olmalıdır.
              </p>
            </div>
          )}

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                  <Scale size={15} className="text-[#007AFF]" />
                  Dağıtım Tablosu
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Taban, o dönemdeki fiş adedidir. Sıfır bırakılan kişi pay almaz.
                </p>
              </div>
              <button
                onClick={handleDistribute}
                disabled={!canDistribute || dagitimliyor || toplamBakiye <= 0}
                className="cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#0A84FF]"
              >
                {dagitimliyor ? 'Dağıtılıyor...' : 'Havuzu Dağıt'}
              </button>
            </div>

            {!canDistribute && (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Dağıtım işlemi para hareketidir ve yalnız işletme sahibine açıktır.
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                  <tr className="border-b border-black/[0.08] text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                    <th className="py-2.5 pr-3 font-medium">Çalışan</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Taban (fiş)</th>
                    <th className="py-2.5 text-right font-medium">Tahmini Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {dagitimlar.map((d) => {
                    const pay =
                      toplamBakiye > 0 && Number(d.basis) > 0
                        ? Math.floor(
                            (ozet.totalCents * Number(d.basis)) / toplamBakiye
                          )
                        : 0;
                    return (
                      <tr
                        key={d.userId}
                        className="border-b border-black/[0.05] dark:border-white/[0.06]"
                      >
                        <td className="py-3 pr-3 text-zinc-700 dark:text-zinc-200">
                          {d.fullName}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={d.basis}
                            onChange={(e) =>
                              setDagitimlar((oncekiler) =>
                                oncekiler.map((x) =>
                                  x.userId === d.userId ? { ...x, basis: e.target.value } : x
                                )
                              )
                            }
                            aria-label={`${d.fullName} dağıtım tabanı`}
                            className="w-24 rounded-2xl border border-black/10 bg-white px-2.5 py-1.5 text-right tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                          />
                        </td>
                        <td className="py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {money(pay)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {dagitimlar.length === 0 && (
                <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  Bu dönemde fiş açan personel bulunamadı.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Özet kutusu. */
function Tile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const renk =
    tone === 'warn'
      ? 'text-[#FF9500] dark:text-[#FF9F0A]'
      : tone === 'ok'
        ? 'text-[#34C759] dark:text-[#30D158]'
        : 'text-zinc-900 dark:text-white';
  return (
    <div className="rounded-3xl border border-black/[0.08] bg-white/75 px-5 py-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={`mt-1.5 text-lg font-semibold tabular-nums ${renk}`}>{value}</p>
    </div>
  );
}

/** `YYYY-MM` dönemini ISO tarih aralığına çevirir. */
function donemAraligi(period: string): [string, string] {
  const [y, m] = period.split('-').map(Number);
  const son = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${period}-01`, `${period}-${String(son).padStart(2, '0')}`];
}