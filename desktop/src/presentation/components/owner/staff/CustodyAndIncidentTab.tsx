import { useCallback, useEffect, useState } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { PackageOpen, ScrollText, PackagePlus } from 'lucide-react';
import {
  StaffEmptyState,
  StaffErrorBar,
  StaffLoading,
  StaffPanelHeader,
  useStaffContext,
} from './StaffPrimitives';
import { formatDate } from './staff360Types';
import type { CustodyRecord, StaffIncident } from './staff360Types';

const OLAY_TIPLERI = ['NOT', 'SOHBET', 'KAZA', 'SIKAYET'] as const;
const SIKILIK = ['Dusuk', 'Orta', 'Yuksek'] as const;

/**
 * Sekme 6 — Zimmet ve Tutanak Sicili.
 *
 * Neden aynı ekran: ikisi de personelin **sorumluluk** kaydıdır ve yönetici
 * "bu kişiye ne teslim edildi, ne oldu" sorusunu tek yerde sorar. Tutanaklar
 * gizlidir; garson başkasının kaydını göremez (RBAC kapısı komut seviyesinde).
 */
export function CustodyAndIncidentTab() {
  const { tenantId, actorRole, actorId, toast } = useStaffContext();

  const [custody, setCustody] = useState<CustodyRecord[]>([]);
  const [incidents, setIncidents] = useState<StaffIncident[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [zimUser, setZimUser] = useState('');
  const [zimItem, setZimItem] = useState('');
  const [zimQty, setZimQty] = useState('1');

  const [olayUser, setOlayUser] = useState('');
  const [olayKind, setOlayKind] = useState<string>('NOT');
  const [olaySeverity, setOlaySeverity] = useState<string>('Dusuk');
  const [olaySummary, setOlaySummary] = useState('');
  const [olayDetails, setOlayDetails] = useState('');

  const yukle = useCallback(
    async (yenile = false) => {
      if (yenile) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const z = await invoke<CustodyRecord[]>('list_custody_records', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
          onlyOpen,
          only_open: onlyOpen,
        });
        setCustody(Array.isArray(z) ? z : []);
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Zimmet kayıtları alınamadı.');
        setCustody([]);
      }
      try {
        const t = await invoke<StaffIncident[]>('list_staff_incidents', {
          actorRole,
          actor_role: actorRole,
          tenantId,
          tenant_id: tenantId,
        });
        setIncidents(Array.isArray(t) ? t : []);
      } catch (e) {
        setError((prev) => prev ?? (typeof e === 'string' ? e : 'Tutanaklar alınamadı.'));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [actorRole, tenantId, onlyOpen]
  );

  useEffect(() => {
    yukle();
  }, [yukle]);

  const handleAddCustody = async () => {
    setError(null);
    try {
      await invoke('add_custody_record', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        userId: zimUser.trim(),
        user_id: zimUser.trim(),
        itemName: zimItem.trim(),
        item_name: zimItem.trim(),
        quantity: Number(zimQty || 1),
      });
      toast({ title: 'Zimmet kaydı açıldı.', type: 'success' });
      setZimItem('');
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Zimmet kaydı açılamadı.');
    }
  };

  const handleCloseCustody = async (id: string, damaged: boolean) => {
    setError(null);
    try {
      await invoke('close_custody_record', {
        actorRole,
        actor_role: actorRole,
        tenantId,
        tenant_id: tenantId,
        custodyId: id,
        custody_id: id,
        damaged,
      });
      toast({
        title: damaged ? 'Zimmet hasarlı kapatıldı.' : 'Zimmet iade edildi.',
        type: damaged ? 'error' : 'success',
      });
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Zimmet kapatılamadı.');
    }
  };

  const handleRecordIncident = async () => {
    setError(null);
    try {
      await invoke('record_staff_incident', {
        actorRole,
        actor_role: actorRole,
        actorId,
        actor_id: actorId,
        tenantId,
        tenant_id: tenantId,
        input: {
          userId: olayUser.trim(),
          user_id: olayUser.trim(),
          kind: olayKind,
          severity: olaySeverity,
          occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          occurred_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          summary: olaySummary.trim(),
          details: olayDetails.trim() || null,
        },
      });
      toast({ title: 'Tutanak kaydedildi.', type: 'success' });
      setOlaySummary('');
      setOlayDetails('');
      await yukle(true);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Tutanak kaydedilemedi.');
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-12">
      <StaffPanelHeader
        icon={<PackageOpen size={22} />}
        title="Zimmet ve Tutanak Sicili"
        description="Teslim edilen malzemeler, iadeler ve personel tutanak kayıtları."
        onRefresh={() => yukle(true)}
        refreshing={refreshing}
      />

      <StaffErrorBar message={error} onClose={() => setError(null)} />

      {loading ? (
        <StaffLoading label="Kayıtlar yükleniyor..." />
      ) : (
        <>
          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
                <PackagePlus size={15} className="text-[#007AFF]" />
                Zimmet Kayıtları
              </h3>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={onlyOpen}
                  onChange={(e) => setOnlyOpen(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#007AFF]"
                />
                Yalnız açık zimmetler
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Personel kimliği
                <input
                  type="text"
                  value={zimUser}
                  onChange={(e) => setZimUser(e.target.value)}
                  placeholder="usr_..."
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Malzeme
                <input
                  type="text"
                  value={zimItem}
                  onChange={(e) => setZimItem(e.target.value)}
                  placeholder="Örn. Tepsi"
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Adet
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={zimQty}
                  onChange={(e) => setZimQty(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm tabular-nums text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <div className="flex items-end">
                <button
                  onClick={handleAddCustody}
                  className="w-full cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2.5 text-xs font-semibold text-white transition-all active:scale-95 dark:bg-[#0A84FF]"
                >
                  Zimmet Aç
                </button>
              </div>
            </div>

            {custody.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState
                  message={onlyOpen ? 'Açık zimmet kaydı yok.' : 'Zimmet kaydı yok.'}
                />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {custody.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {c.itemName} · {c.quantity} adet
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                        {c.userId} · {formatDate(c.deliveredAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          c.status === 'Teslim'
                            ? 'border-[#0A84FF]/30 bg-[#0A84FF]/15 text-[#007AFF] dark:text-[#409CFF]'
                            : c.status === 'Hasarli'
                              ? 'border-[#FF453A]/30 bg-[#FF453A]/15 text-[#FF3B30] dark:text-[#FF453A]'
                              : 'border-[#30D158]/30 bg-[#30D158]/15 text-[#34C759] dark:text-[#30D158]'
                        }`}
                      >
                        {c.status}
                      </span>
                      {c.status === 'Teslim' && (
                        <>
                          <button
                            onClick={() => handleCloseCustody(c.id, false)}
                            aria-label={`${c.itemName} iadesini kapat`}
                            className="cursor-pointer rounded-2xl bg-[#34C759] px-3 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95 dark:bg-[#30D158]"
                          >
                            İade
                          </button>
                          <button
                            onClick={() => handleCloseCustody(c.id, true)}
                            aria-label={`${c.itemName} zimmetini hasarlı kapat`}
                            className="cursor-pointer rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition-all hover:bg-rose-500/20 dark:text-rose-300"
                          >
                            Hasarlı
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-black/[0.08] bg-white/75 p-5 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
              <ScrollText size={15} className="text-[#BF5AF2]" />
              Tutanak Sicili
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Kayıtlar yalnız yönetim kadrosuna açıktır ve silinmez; olay kapandığında
              durumu değişir, geçmiş korunur.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Personel kimliği
                <input
                  type="text"
                  value={olayUser}
                  onChange={(e) => setOlayUser(e.target.value)}
                  placeholder="usr_..."
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Tür
                <select
                  value={olayKind}
                  onChange={(e) => setOlayKind(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                >
                  {OLAY_TIPLERI.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Şiddet
                <select
                  value={olaySeverity}
                  onChange={(e) => setOlaySeverity(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                >
                  {SIKILIK.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 md:col-span-2">
                Özet
                <input
                  type="text"
                  value={olaySummary}
                  onChange={(e) => setOlaySummary(e.target.value)}
                  placeholder="Tek cümlelik özet"
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 md:col-span-4">
                Ayrıntı
                <textarea
                  value={olayDetails}
                  onChange={(e) => setOlayDetails(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-[#007AFF] focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
                />
              </label>
              <div className="flex items-end md:col-span-1">
                <button
                  onClick={handleRecordIncident}
                  className="w-full cursor-pointer rounded-2xl bg-[#007AFF] px-4 py-2.5 text-xs font-semibold text-white transition-all active:scale-95 dark:bg-[#0A84FF]"
                >
                  Kaydet
                </button>
              </div>
            </div>

            {incidents.length === 0 ? (
              <div className="mt-4">
                <StaffEmptyState message="Tutanak kaydı yok." />
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {incidents.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
                        {i.kind} · {i.summary}
                      </span>
                      <span className="rounded-full border border-black/10 px-2.5 py-1 text-[10px] font-semibold text-zinc-600 dark:border-white/15 dark:text-zinc-300">
                        {i.severity} · {i.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-zinc-400">
                      {i.userId} · {formatDate(i.occurredAt)}
                    </p>
                    {i.details && (
                      <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">{i.details}</p>
                    )}
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