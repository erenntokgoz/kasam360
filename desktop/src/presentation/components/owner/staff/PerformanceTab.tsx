import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { ChartNoAxesColumn, ShieldAlert } from 'lucide-react';
import {
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { money } from './staff360Types';
import type { StaffKpi, SuspiciousFlag } from './staff360Types';

function gunBasi(): string {
  const d = new Date();
  const ilk = new Date(d.getFullYear(), d.getMonth(), 1);
  return `${ilk.getFullYear()}-${String(ilk.getMonth() + 1).padStart(2, '0')}-01`;
}

function bugun(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Sekme 5 — Performans: KPI tablosu ve şüpheli işlem radarı.
 *
 * Radar tasarımı: eşik altı uyarı üretilmez. Az örneklemli veriden çıkan
 * "anormallik" bir kişiyi haksız yere işaretler; her bayrak yanında ölçümü ve
 * eşiğini gösteriyoruz ki patron "neden bu uyarı?" sorusunu ekranda yanıtlayabilsin.
 */
export function PerformanceTab() {
  const { tenantId, actorRole } = useStaffContext();
  const [from, setFrom] = useState(gunBasi());
  const [to, setTo] = useState(bugun());

  const [kpi, setKpi] = useState<StaffKpi[]>([]);
  const [bayraklar, setBayraklar] = useState<SuspiciousFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      if (from > to) {
        setError('Tarih aralığı ters. Başlangıç bitişten sonra olamaz.');
        setKpi([]);
        setBayraklar([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      try {
        const veri = await invoke<StaffKpi[]>('get_staff_kpi', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
          from,
          to,
        });
        setKpi(Array.isArray(veri) ? veri : []);
      } catch (e) {
        setError(typeof e === 'string' ? e : 'KPI verisi alınamadı.');
        setKpi([]);
      }
      try {
        const rad = await invoke<SuspiciousFlag[]>('get_suspicious_activity', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
          from,
          to,
        });
        setBayraklar(Array.isArray(rad) ? rad : []);
      } catch (e) {
        setError((prev) => prev ?? (typeof e === 'string' ? e : 'Rapor alınamadı.'));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [actorRole, tenantId, from, to]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  const siraliKpi = [...kpi].sort((a, b) => b.grossSalesCents - a.grossSalesCents);
  const toplamCiro = siraliKpi.reduce((t, k) => t + k.grossSalesCents, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<ChartNoAxesColumn size={22} />}
        title="Personel Performansı"
        description="Fiş adedi, ciro, ortalama fiş ve iptal sayısı; şüpheli işlem radarı."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      <div className="flex flex-wrap items-end gap-4 rounded-3xl border border-black/[0.08] bg-white/75 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Başlangıç
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="KPI başlangıç tarihi"
            className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
          />
        </label>
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Bitiş
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="KPI bitiş tarihi"
            className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
          />
        </label>
      </div>

      {loading ? (
        <StaffLoading label="Performans verisi hesaplanıyor..." />
      ) : (
        <>
          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              Personel Sıralaması
            </h3>
            {siraliKpi.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState
                  message="Bu aralıkta satış kaydı yok."
                  hint="KPI, ödenmiş siparişlerden hesaplanır; açık fişler sayılmaz."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/[0.08] text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                      <th className="py-2.5 pr-3 font-medium">Personel</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Fiş</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Kalem</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Ciro</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Ort. Fiş</th>
                      <th className="py-2.5 text-right font-medium">İptal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siraliKpi.map((k) => (
                      <tr
                        key={k.userId}
                        className="border-b border-black/[0.05] dark:border-white/[0.06]"
                      >
                        <td className="py-3 pr-3">
                          <span className="font-medium text-zinc-800 dark:text-zinc-100">
                            {k.fullName}
                          </span>
                          {k.topProduct && (
                            <span className="ml-2 text-[10px] text-zinc-400">
                              en çok: {k.topProduct}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {k.orderCount}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {k.itemCount}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {money(k.grossSalesCents)}
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {k.orderCount > 0 ? money(k.avgTicketCents) : 'Veri yok'}
                        </td>
                        <td
                          className={`py-3 text-right tabular-nums ${
                            k.voidCount > 0
                              ? 'text-[#FF9500] dark:text-[#FF9F0A]'
                              : 'text-zinc-400'
                          }`}
                        >
                          {k.voidCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/[0.08] dark:border-white/10">
                      <td className="py-2.5 pr-3 font-semibold text-zinc-800 dark:text-zinc-100">
                        Toplam
                      </td>
                      <td colSpan={2} />
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                        {money(toplamCiro)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
              <ShieldAlert size={15} className="text-[#FF9F0A]" />
              Şüpheli İşlem Radarı
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Eşik altı kayıt uyarı üretmez. Az örneklemli veriden çıkan uyarı,
              personele haksızlık eder.
            </p>

            {bayraklar.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState
                  message="Bu aralıkta eşiği aşan bir kayıt yok."
                  hint="Radar yalnızca asgari örneklem eşiğini geçen kayıtları listeler."
                />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {bayraklar.map((b, idx) => (
                  <li
                    key={`${b.userId}-${b.rule}-${idx}`}
                    className="rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {b.fullName} · {b.rule}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          b.severity === 'Yuksek'
                            ? 'border-[#FF453A]/30 bg-[#FF453A]/15 text-[#FF3B30] dark:text-[#FF453A]'
                            : 'border-[#FF9F0A]/30 bg-[#FF9F0A]/15 text-[#FF9500] dark:text-[#FF9F0A]'
                        }`}
                      >
                        {b.severity}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                      {b.detail} · ölçülen {b.measured}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-400">kural: {b.threshold}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}