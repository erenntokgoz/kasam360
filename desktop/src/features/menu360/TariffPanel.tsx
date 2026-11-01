import React, { useCallback, useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useAuthStore } from '../../stores/authStore';
import { usePosStore } from '../../stores/posStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

type TariffKind = 'GUNDUZ' | 'GECE' | 'CANLI_MUZIK' | 'OZEL';

interface Tariff {
  id: string;
  name: string;
  kind: TariffKind;
  percent: number;
  productIds: string[];
  isActive: boolean;
}

interface ProductOption {
  id: string;
  name: string;
}

const KIND_LABEL: Record<TariffKind, string> = {
  GUNDUZ: 'Gündüz',
  GECE: 'Gece',
  CANLI_MUZIK: 'Canlı müzik',
  OZEL: 'Özel',
};

const field = 'min-h-12 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';

/** Tarife elle açılır. Açık tarife yalnız bundan sonra eklenen kalemin fiyatını belirler. */
export const TariffPanel: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const loadCatalog = usePosStore((state) => state.loadCatalog);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<TariffKind>('GECE');
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [percent, setPercent] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);

  const refresh = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [list, catalog] = await Promise.all([
        invokeIPC<Tariff[]>('get_price_tariffs', { actorRole, tenantId }),
        invokeIPC<ProductOption[]>('pos_get_products', { tenantId }),
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
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const value = Number(percent.trim().replace(',', '.'));
    if (!name.trim() || !Number.isInteger(value) || value <= 0) {
      setError('Tarife adı ve tam sayı yüzde girin.');
      return;
    }
    if (onlySelected && selected.length === 0) {
      setError('En az bir ürün seçin.');
      return;
    }
    void run(async () => {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('save_price_tariff', {
        actorRole,
        actorId,
        tenantId,
        input: {
          name: name.trim(),
          kind,
          percent: direction === 'UP' ? value : -value,
          productIds: onlySelected ? selected : null,
        },
      });
      setName('');
      setPercent('');
      setSelected([]);
      setOnlySelected(false);
    });
  };

  const setActive = (tariffId: string | null) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('set_active_price_tariff', { actorRole, actorId, tenantId, tariffId }));
  };

  const remove = (tariffId: string) => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    void run(() => invokeIPC('delete_price_tariff', { actorRole, actorId, tenantId, tariffId }));
  };

  const active = tariffs.find((tariff) => tariff.isActive);

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[var(--text-primary)]">
      <p className="text-xs text-[var(--text-secondary)]">
        {active ? `Şu an açık: ${active.name}` : 'Şu an menü fiyatları geçerli.'} Adisyona eklenmiş kalemin fiyatı değişmez.
      </p>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}

      {isOwner ? (
        <section className="rounded-xl border border-[var(--border)] paper p-4 space-y-3">
          <h2 className="print-title text-xl">Yeni tarife</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            <select aria-label="Tarife türü" className={field} value={kind} onChange={(event) => setKind(event.target.value as TariffKind)}>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Input aria-label="Tarife adı" placeholder="Tarife adı" className="min-h-12" value={name} onChange={(event) => setName(event.target.value)} />
            <select aria-label="Tarife yönü" className={field} value={direction} onChange={(event) => setDirection(event.target.value as 'UP' | 'DOWN')}>
              <option value="UP">Zam</option>
              <option value="DOWN">İndirim</option>
            </select>
            <Input aria-label="Tarife yüzdesi" inputMode="numeric" placeholder="Yüzde" className="min-h-12" value={percent} onChange={(event) => setPercent(event.target.value)} />
          </div>
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" className="w-6 h-6" checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)} />
            <span>Yalnız seçilen ürünlere uygula</span>
          </label>
          {onlySelected ? (
            <div className="grid gap-1 sm:grid-cols-3 max-h-56 overflow-y-auto">
              {products.map((product) => (
                <label key={product.id} className="flex min-h-12 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(product.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id),
                      )
                    }
                  />
                  <span className="truncate">{product.name}</span>
                </label>
              ))}
            </div>
          ) : null}
          <Button variant="primary" className="min-h-12" disabled={busy} onClick={save}>Tarifeyi Kaydet</Button>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] paper">
        <h2 className="border-b border-[var(--border)] p-4 print-title text-xl">Tarifeler</h2>
        {tariffs.length === 0 ? <p className="p-4 text-xs text-[var(--text-secondary)]">Tanımlı tarife yok.</p> : null}
        <ul className="divide-y divide-[var(--border)]">
          {tariffs.map((tariff) => (
            <li key={tariff.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="font-bold">{tariff.name}</span>
                <span className="ml-2 text-xs text-[var(--text-secondary)]">
                  {KIND_LABEL[tariff.kind]} · {tariff.percent > 0 ? '+' : ''}%{tariff.percent} ·{' '}
                  {tariff.productIds.length === 0 ? 'Tüm ürünler' : `${tariff.productIds.length} ürün`}
                </span>
              </span>
              <span className="flex gap-2">
                {tariff.isActive ? (
                  <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => setActive(null)}>Kapat</Button>
                ) : (
                  <Button variant="primary" className="min-h-12" disabled={busy} onClick={() => setActive(tariff.id)}>Etkinleştir</Button>
                )}
                {isOwner && !tariff.isActive ? (
                  <Button variant="secondary" className="min-h-12" disabled={busy} onClick={() => remove(tariff.id)}>Sil</Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
