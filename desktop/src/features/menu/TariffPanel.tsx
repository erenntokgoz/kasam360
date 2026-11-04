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

/** Saatli tarife kendiliğinden açılır; saatsiz tarife elle açılır. Eklenmiş kalemin fiyatı değişmez. */
export const TariffPanel: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const loadCatalog = usePosStore((state) => state.loadCatalog);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Tariff | 'NEW' | null>(null);

  const refresh = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [list, catalog] = await Promise.all([
        invokeIPC<Tariff[]>('get_price_tariffs', { actorRole, tenantId }),
        invokeIPC<{ id: string; name: string }[]>('pos_get_products', { tenantId }),
      ]);
      setTariffs(list);
      setProducts(catalog);
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
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const save = (draft: TariffDraft) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('save_price_tariff', { actorRole, actorId, tenantId, input: { ...draft, kind: 'OZEL' } }));
  };

  const toggleSchedule = (tariff: Tariff) => {
    if (!tariff.schedule) return;
    save({ ...tariff, productIds: tariff.productIds, schedule: { ...tariff.schedule, enabled: !tariff.schedule.enabled } });
  };

  const setActive = (tariffId: string | null) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('set_active_price_tariff', { actorRole, actorId, tenantId, tariffId }));
  };

  const remove = (tariffId: string) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('delete_price_tariff', { actorRole, actorId, tenantId, tariffId }));
  };

  return (
    <div className="page-fill flex-1 overflow-y-auto p-4 space-y-4 text-[var(--text-primary)]">
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      {isOwner ? <Button variant="primary" className="min-h-12" onClick={() => setEditing('NEW')}>Tarife Ekle</Button> : null}

      <section className="rounded-xl border border-[var(--border)] paper">
        <h2 className="print-title border-b border-[var(--border)] p-4 text-sm font-bold">Tarifeler</h2>
        {tariffs.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Tanımlı tarife yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {tariffs.map((tariff) => (
            <li key={tariff.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-bold">{tariff.name}</span>
                <span className="block text-xs text-[var(--text-secondary)] tabular-nums">
                  {tariff.percent > 0 ? `%${tariff.percent} zam` : `%${-tariff.percent} indirim`} ·{' '}
                  {tariff.productIds.length === 0 ? 'Tüm ürünler' : `${tariff.productIds.length} ürün`}
                  {tariff.schedule ? ` · ${scheduleText(tariff.schedule)}` : ''}
                </span>
              </span>
              <span className="flex gap-2">
                {tariff.schedule ? (
                  isOwner ? (
                    <Button variant={tariff.schedule.enabled ? 'secondary' : 'primary'} className="min-h-12" disabled={busy} onClick={() => toggleSchedule(tariff)}>
                      {tariff.schedule.enabled ? 'Durdur' : 'Başlat'}
                    </Button>
                  ) : null
                ) : tariff.isActive ? (
                  <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => setActive(null)}>Kapat</Button>
                ) : (
                  <Button variant="primary" className="min-h-12" disabled={busy} onClick={() => setActive(tariff.id)}>Etkinleştir</Button>
                )}
                {isOwner && !tariff.isActive ? (
                  <>
                    <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => setEditing(tariff)}>Düzenle</Button>
                    <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => remove(tariff.id)}>Sil</Button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {editing ? (
        <TariffFormModal tariff={editing === 'NEW' ? null : editing} products={products} busy={busy} onClose={() => setEditing(null)} onSave={save} />
      ) : null}
    </div>
  );
};
