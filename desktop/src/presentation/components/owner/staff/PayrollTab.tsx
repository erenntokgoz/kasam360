import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { Wallet, AlertTriangle, Lock } from 'lucide-react';
import {
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { MODEL_LABELS, currentPeriod, money, shiftPeriod } from './staff360Types';
import type { PayrollRule, PayrollRun } from './staff360Types';

const MODELLER = ['FIXED', 'COMMISSION', 'TIP', 'HOURLY', 'PROFIT_SHARE'] as const;

/**
 * Sekme 2 — Maaş: beş model, kural tanımı ve dönem bordrosu.
 *
 * Gizlilik kuralı (AGENTS.md §3.2): müdür model ve kişi listesini görür, **tutarı
 * görmez**. Ekranda "Yetkiniz yok" yazar; sıfır yazılsaydı müdür "kazandı mı,
 * kazanmadı mı" sorusunu yanlış cevaplayabilirdi.
 */
export function PayrollTab() {
  const { tenantId, actorRole, toast } = useStaffContext();
  const canSeeAmounts = actorRole === 'OWNER';

  const [period, setPeriod] = useState(currentPeriod());
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calistiriliyor, setCalistiriliyor] = useState(false);

  const [ruleUser, setRuleUser] = useState('');
  const [ruleModel, setRuleModel] = useState<string>('FIXED');
  const [ruleBase, setRuleBase] = useState('');
  const [ruleCommission, setRuleCommission] = useState('');
  const [ruleHourly, setRuleHourly] = useState('');
  const [ruleProfit, setRuleProfit] = useState('');

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const kuralListesi = await invoke<PayrollRule[]>('get_payroll_rules', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
        });
        setRules(Array.isArray(kuralListesi) ? kuralListesi : []);
        setRuleUser((mevcut) => mevcut || (Array.isArray(kuralListesi) && kuralListesi[0]?.userId) || '');
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Maaş kuralları alınamadı.');
        setRules([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actorRole, tenantId]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  const handleSaveRule = async () => {
    if (!ruleUser) {
      setError('Önce bir çalışan seçin.');
      return;
    }
    setError(null);
    try {
      await invoke('set_payroll_rule', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        input: {
          userId: ruleUser,
          model: ruleModel,
          baseSalaryCents: toCents(ruleBase),
          commissionPercent: Number(ruleCommission || 0),
          hourlyRateCents: toCents(ruleHourly),
          tipMultiplierPercent: 100,
          profitSharePercent: Number(ruleProfit || 0),
        },
      });
      toast({ title: 'Maaş kuralı kaydedildi.', type: 'success' });
      setRuleBase('');
      setRuleCommission('');
      setRuleHourly('');
      setRuleProfit('');
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Kural kaydedilemedi.');
    }
  };

  const handleRun = async () => {
    setCalistiriliyor(true);
    setError(null);
    try {
      const sonuc = await invoke<PayrollRun[]>('run_payroll', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        period,
      });
      setRuns(Array.isArray(sonuc) ? sonuc : []);
      toast({ title: `${period} dönemi hesaplandı.`, type: 'success' });
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Bordro hesaplanamadı.');
      setRuns([]);
    } finally {
      setCalistiriliyor(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<Wallet size={22} />}
        title="Maaş ve Bordro"
        description="Beş maaş modeli: sabit, satış komisyonu, bahşiş, saatlik ve kâr payı."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      {!canSeeAmounts && (
        <div className="flex items-start gap-2 rounded-3xl border border-[#0A84FF]/20 bg-[#0A84FF]/10 px-4 py-3 text-xs text-[#007AFF] dark:text-[#409CFF]">
          <Lock size={14} className="mt-0.5 shrink-0" />
          <p>
            Müdür rolü maaş kuralını ve bordroyu görebilir, ancak **tutarları
            göremez**. Tutar yalnız işletme sahibine açıktır.
          </p>
        </div>
      )}

      {loading ? (
        <StaffLoading label="Maaş kuralları yükleniyor..." />
      ) : (
        <>
          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              Maaş Kuralı Tanımla
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Çalışan
                <select
                  value={ruleUser}
                  onChange={(e) => setRuleUser(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                >
                  <option value="">Seçiniz</option>
                  {rules.map((r) => (
                    <option key={r.userId} value={r.userId}>
                      {r.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Model
                <select
                  value={ruleModel}
                  onChange={(e) => setRuleModel(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                >
                  {MODELLER.map((m) => (
                    <option key={m} value={m}>
                      {MODEL_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Sabit Maaş (₺)
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={ruleBase}
                  onChange={(e) => setRuleBase(e.target.value)}
                  disabled={!canSeeAmounts}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Komisyon (%)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={ruleCommission}
                  onChange={(e) => setRuleCommission(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Saatlik Ücret (₺)
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={ruleHourly}
                  onChange={(e) => setRuleHourly(e.target.value)}
                  disabled={!canSeeAmounts}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Kâr Payı (%)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={ruleProfit}
                  onChange={(e) => setRuleProfit(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveRule}
                disabled={!canSeeAmounts}
                className="cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#0A84FF]"
              >
                Kuralı Kaydet
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                  Dönem Bordrosu
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Hesap gerçek satış, vardiye saati ve bahşiş kayıtlarından yapılır.
                </p>
              </div>
              <div className="flex items-end gap-2.5">
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
                      aria-label="Bordro dönemi"
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
                <button
                  onClick={handleRun}
                  disabled={calistiriliyor || !/^\d{4}-\d{2}$/.test(period)}
                  className="cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#0A84FF]"
                >
                  {calistiriliyor ? 'Hesaplanıyor...' : 'Bordroyu Hesapla'}
                </button>
              </div>
            </div>

            {runs.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState
                  message="Bu dönem için hesaplanmış bordro yok."
                  hint="Tutarın doğruluğunu görmek için bordroyu hesaplayın."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/[0.08] text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                      <th className="py-2.5 pr-3 font-medium">Çalışan</th>
                      <th className="py-2.5 pr-3 font-medium">Model</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Sabit</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Komisyon</th>
                      <th className="py-2.5 pr-3 text-right font-medium">Bahşiş</th>
                      <th className="py-2.5 text-right font-medium">Brüt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr
                        key={r.userId}
                        className="border-b border-black/[0.05] dark:border-white/[0.06]"
                      >
                        <td className="py-3 pr-3">
                          <span className="font-medium text-zinc-800 dark:text-zinc-100">
                            {r.fullName}
                          </span>
                          <span className="ml-2 text-[10px] text-zinc-400">{r.role}</span>
                        </td>
                        <td className="py-3 pr-3 text-zinc-600 dark:text-zinc-300">
                          {MODEL_LABELS[r.model] ?? r.model}
                        </td>
                        {r.amounts ? (
                          <>
                            <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                              {money(r.amounts.baseCents)}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                              {money(r.amounts.commissionCents)}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                              {money(r.amounts.tipCents)}
                            </td>
                            <td className="py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                              {money(r.amounts.grossCents)}
                            </td>
                          </>
                        ) : (
                          <td colSpan={4} className="py-3 text-right text-zinc-400">
                            Tutarlar görünmüyor
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {runs.some((r) => r.warning) && (
              <ul className="mt-4 flex flex-col gap-2">
                {runs
                  .filter((r) => r.warning)
                  .map((r) => (
                    <li
                      key={r.userId}
                      className="flex items-start gap-2 rounded-2xl border border-[#FF9F0A]/25 bg-[#FF9F0A]/10 px-3.5 py-2.5 text-xs text-[#FF9500] dark:text-[#FF9F0A]"
                    >
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <strong>{r.fullName}:</strong> {r.warning}
                      </span>
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

/** TL metnini kuruşa çevirir. Geçersiz metin `0` değil hata yolunu tetikler. */
function toCents(raw: string): number {
  const deger = Number((raw || '0').replace(',', '.'));
  if (!Number.isFinite(deger) || deger < 0) return 0;
  return Math.round(deger * 100);
}