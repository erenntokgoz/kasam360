import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { CalendarDays, CalendarPlus, Check, X } from 'lucide-react';
import {
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { ROLE_LABELS, formatDate } from './staff360Types';
import type { LeaveRequest, ShiftPlan } from './staff360Types';

/** Bugünün ISO tarihi (`YYYY-MM-DD`). Saat dilimi yerel: plan takvim günüdür. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function plusDays(iso: string, gun: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + gun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Sekme 4 — Vardiya Planlama ve İzin Yönetimi.
 *
 * İki konu tek ekranda: ikisi de "personelin zamanı" kararıdır ve karar veren
 * kişi aynıdır. Ayrı sekmelere bölmek onay kuyruğunu gizlerdi.
 */
export function ShiftAndLeaveTab() {
  const { tenantId, actorRole, actorId, toast } = useStaffContext();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(plusDays(today(), 13));

  const [plans, setPlans] = useState<ShiftPlan[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [planUser, setPlanUser] = useState('');
  const [planRole, setPlanRole] = useState('WAITER');
  const [planStart, setPlanStart] = useState('09:00');
  const [planEnd, setPlanEnd] = useState('17:00');
  const [planBreak, setPlanBreak] = useState('30');

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const p = await invoke<ShiftPlan[]>('list_shift_plans', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
          from,
          to,
        });
        setPlans(Array.isArray(p) ? p : []);
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Vardiya planları alınamadı.');
        setPlans([]);
      }
      try {
        const l = await invoke<LeaveRequest[]>('list_leave_requests', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
        });
        setLeaves(Array.isArray(l) ? l : []);
      } catch (e) {
        setError((prev) => prev ?? (typeof e === 'string' ? e : 'İzin talepleri alınamadı.'));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [actorRole, tenantId, from, to]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  const handleAddPlan = async () => {
    if (!planUser) {
      setError('Planlanacak personeli seçin.');
      return;
    }
    setError(null);
    try {
      await invoke('add_shift_plan', {
        actorRole,
        actor_role: actorRole,
        actorId,
        actor_id: actorId,
        tenantId,
        tenant_id: tenantId,
        plan: {
          userId: planUser,
          planDate: from,
          startTime: planStart,
          endTime: planEnd,
          plannedBreakMinutes: Number(planBreak || 0),
          roleRequired: planRole,
        },
      });
      toast({ title: 'Vardiya planı eklendi.', type: 'success' });
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Plan eklenemedi.');
    }
  };

  const handleDecide = async (leaveId: string, approve: boolean) => {
    setError(null);
    try {
      await invoke('decide_leave', {
        actorRole,
        actor_role: actorRole,
        approverId: actorId,
        approver_id: actorId,
        tenantId,
        tenant_id: tenantId,
        leaveId,
        leave_id: leaveId,
        approve,
      });
      toast({
        title: approve ? 'İzin onaylandı.' : 'İzin reddedildi.',
        type: approve ? 'success' : 'info',
      });
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'İzin kararı kaydedilemedi.');
    }
  };

  const bekleyen = leaves.filter((l) => l.status === 'Bekliyor');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<CalendarDays size={22} />}
        title="Vardiya Planlama ve İzin"
        description="Haftalık vardiya dağılımı ve izin onay kuyruğu."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      {loading ? (
        <StaffLoading label="Plan ve izinler yükleniyor..." />
      ) : (
        <>
          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Başlangıç
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-label="Plan başlangıç tarihi"
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Bitiş
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  aria-label="Plan bitiş tarihi"
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
            </div>

            {from > to && (
              <p className="mt-3 text-xs text-[#FF9500] dark:text-[#FF9F0A]">
                Başlangıç tarihi bitişten sonra. Aralık ters olduğunda hiç plan
                gösterilmez.
              </p>
            )}

            {plans.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState
                  message="Bu tarih aralığında vardiya planı yok."
                  hint="Aşağıdaki formla plan ekleyin."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/[0.08] text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                      <th className="py-2.5 pr-3 font-medium">Personel</th>
                      <th className="py-2.5 pr-3 font-medium">Tarih</th>
                      <th className="py-2.5 pr-3 font-medium">Saat</th>
                      <th className="py-2.5 pr-3 font-medium">Rol</th>
                      <th className="py-2.5 text-right font-medium">Mola</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-black/[0.05] dark:border-white/[0.06]"
                      >
                        <td className="py-3 pr-3 text-zinc-800 dark:text-zinc-100">
                          {p.userName}
                        </td>
                        <td className="py-3 pr-3 text-zinc-600 dark:text-zinc-300">
                          {formatDate(p.planDate)}
                        </td>
                        <td className="py-3 pr-3 tabular-nums text-zinc-700 dark:text-zinc-200">
                          {p.startTime} - {p.endTime}
                        </td>
                        <td className="py-3 pr-3 text-zinc-600 dark:text-zinc-300">
                          {ROLE_LABELS[p.roleRequired] ?? p.roleRequired}
                        </td>
                        <td className="py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                          {p.plannedBreakMinutes} dk
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
              <CalendarPlus size={15} className="text-[#007AFF]" />
              Yeni Vardiya Planı
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Personel
                <input
                  type="text"
                  value={planUser}
                  onChange={(e) => setPlanUser(e.target.value)}
                  placeholder="Kullanıcı kimliği"
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Rol
                <select
                  value={planRole}
                  onChange={(e) => setPlanRole(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                >
                  {['WAITER', 'CASHIER', 'KITCHEN', 'MANAGER'].map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r] ?? r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Başlangıç
                <input
                  type="time"
                  value={planStart}
                  onChange={(e) => setPlanStart(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Bitiş
                <input
                  type="time"
                  value={planEnd}
                  onChange={(e) => setPlanEnd(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Mola (dk)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={planBreak}
                  onChange={(e) => setPlanBreak(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Plan tarihi olarak seçili aralığın başlangıcı kullanılır.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleAddPlan}
                className="cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 dark:bg-[#0A84FF]"
              >
                Planı Ekle
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              İzin Talepleri
              {bekleyen.length > 0 && (
                <span className="ml-2 rounded-full bg-[#FF9F0A]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FF9500] dark:text-[#FF9F0A]">
                  {bekleyen.length} bekleyen
                </span>
              )}
            </h3>

            {leaves.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState message="İzin talebi yok." />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {leaves.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {l.kind} · {formatDate(l.startDate)} - {formatDate(l.endDate)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-400">{l.userId}</p>
                      {l.reason && (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{l.reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          l.status === 'Onaylandi'
                            ? 'border-[#30D158]/30 bg-[#30D158]/15 text-[#34C759] dark:text-[#30D158]'
                            : l.status === 'Reddedildi'
                              ? 'border-[#FF453A]/30 bg-[#FF453A]/15 text-[#FF3B30] dark:text-[#FF453A]'
                              : 'border-[#FF9F0A]/30 bg-[#FF9F0A]/15 text-[#FF9500] dark:text-[#FF9F0A]'
                        }`}
                      >
                        {l.status}
                      </span>
                      {l.status === 'Bekliyor' && (
                        <>
                          <button
                            onClick={() => handleDecide(l.id, true)}
                            aria-label="İzni onayla"
                            className="flex cursor-pointer items-center gap-1 rounded-2xl bg-[#34C759] px-3 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95 dark:bg-[#30D158]"
                          >
                            <Check size={13} />
                            <span>Onayla</span>
                          </button>
                          <button
                            onClick={() => handleDecide(l.id, false)}
                            aria-label="İzni reddet"
                            className="flex cursor-pointer items-center gap-1 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition-all hover:bg-rose-500/20 dark:text-rose-300"
                          >
                            <X size={13} />
                            <span>Reddet</span>
                          </button>
                        </>
                      )}
                    </div>
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