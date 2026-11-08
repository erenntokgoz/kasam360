import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { usePosStore } from '../../stores/posStore';
import { Button } from '../../ui/Button';
import { DAY_LABELS, TariffFormModal, type Tariff, type TariffDraft, type TariffSchedule } from './TariffFormModal';

const scheduleText = (schedule: TariffSchedule) =>
  [
    schedule.startTime ? `${schedule.startTime} - ${schedule.endTime}` : null,
    schedule.daysOfWeek.length ? schedule.daysOfWeek.map((day) => DAY_LABELS[day - 1]).join(', ') : null,
    schedule.validFrom || schedule.validTo ? `${schedule.validFrom ?? ''} / ${schedule.validTo ?? ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** Takvimli tarife takvimi açılınca, takvimsiz tarife elle açılınca açık sayılır. */
export const isTariffOpen = (tariff: Tariff) => tariff.isActive || Boolean(tariff.schedule?.enabled);

/** Uygulanan tarifeyi sunucu söyler: elle açılan, takvimi gelenin önüne geçer. */
export function tariffStatus(tariff: Tariff, appliedId: string | null): string {
  if (!isTariffOpen(tariff)) return 'Kapalı';
  return tariff.id === appliedId ? 'Açık · uygulanıyor' : 'Açık · takvim bekliyor';
}

/** Eklenmiş kalemin fiyatı tarifeyle değişmez; tarife yalnız yeni kalemleri etkiler. */
export const TariffPanel: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const loadCatalog = usePosStore((state) => state.loadCatalog);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Tariff | 'NEW' | null>(null);

  const refresh = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [list, catalog, applied] = await Promise.all([
        invokeIPC<Tariff[]>('get_price_tariffs', { actorRole, tenantId }),
        invokeIPC<{ id: string; name: string }[]>('pos_get_products', { tenantId }),
        invokeIPC<{ id: string } | null>('get_active_price_tariff', { tenantId }),
      ]);
      setTariffs(list);
      setProducts(catalog);
      setAppliedId(applied?.id ?? null);
    } catch (caught) {
      setError(String(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      // Açık kasa ekranı yeni fiyatı beklemeden görsün.
      await loadCatalog();
      setEditing(null);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveTariff = (draft: TariffDraft) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    return invokeIPC('save_price_tariff', { actorRole, actorId, tenantId, input: { ...draft, kind: 'OZEL' } });
  };

  const setActive = (tariffId: string | null) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    return invokeIPC('set_active_price_tariff', { actorRole, actorId, tenantId, tariffId });
  };

  // Takvimsiz tarife açılınca hemen uygulanır; takvimli tarife açılınca penceresini bekler.
  const toggle = (tariff: Tariff) => {
    const isOpen = isTariffOpen(tariff);
    void run(async () => {
      if (isOpen && tariff.isActive) await setActive(null);
      if (tariff.schedule && tariff.schedule.enabled === isOpen) {
        await saveTariff({ ...tariff, schedule: { ...tariff.schedule, enabled: !isOpen } });
      } else if (!tariff.schedule && !isOpen) {
        await setActive(tariff.id);
      }
    });
  };

  const remove = (tariffId: string) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('delete_price_tariff', { actorRole, actorId, tenantId, tariffId }));
  };

  return (
    <div className="page-fill flex-1 overflow-y-auto p-4 space-y-4 text-[var(--text-primary)]">
      {error ? <ErrorToast message={error} /> : null}

      <section className="rounded-xl border border-[var(--border)] paper">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <h2 className="print-title text-sm font-bold">Tarifeler</h2>
          {isOwner ? <Button variant="primary" className="min-h-12" onClick={() => setEditing('NEW')}>Tarife Ekle</Button> : null}
        </div>
        {tariffs.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Tanımlı tarife yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {tariffs.map((tariff) => {
            const isOpen = isTariffOpen(tariff);
            // Takvimi yalnız tarifeyi tanımlayan patron açıp kapatır; müdür elle açılanı yönetir.
            const canToggle = isOwner || !tariff.schedule;
            return (
              <li key={tariff.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-bold">{tariff.name}</span>
                  <span className="block text-xs text-[var(--text-secondary)] tabular-nums">
                    {tariff.percent > 0 ? `%${tariff.percent} zam` : `%${-tariff.percent} indirim`} ·{' '}
                    {tariff.productIds.length === 0 ? 'Tüm ürünler' : `${tariff.productIds.length} ürün`}
                    {tariff.schedule ? ` · ${scheduleText(tariff.schedule)}` : ''}
                  </span>
                  <span className={`block text-xs font-bold ${isOpen ? 'text-[var(--accent-emerald)]' : 'text-[var(--text-secondary)]'}`}>
                    {tariffStatus(tariff, appliedId)}
                  </span>
                </span>
                <span className="flex gap-2">
                  {canToggle ? (
                    <Button variant={isOpen ? 'secondary' : 'primary'} className="min-h-12" disabled={busy} onClick={() => toggle(tariff)}>
                      {isOpen ? 'Kapat' : 'Aç'}
                    </Button>
                  ) : null}
                  {isOwner && !isOpen ? (
                    <>
                      <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => setEditing(tariff)}>Düzenle</Button>
                      <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => remove(tariff.id)}>Sil</Button>
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {editing ? (
        <TariffFormModal
          tariff={editing === 'NEW' ? null : editing}
          products={products}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(draft) => void run(() => saveTariff(draft))}
        />
      ) : null}
    </div>
  );
};
