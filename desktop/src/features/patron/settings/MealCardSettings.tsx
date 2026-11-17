import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { ErrorToast } from '../../../ui/ErrorToast';
import { loadMealCardProviders, type MealCardProvider } from '../../payment/mealCards';

/** Hangi yemek kartı markalarının ödeme ekranında seçilebileceği. */
export const MealCardSettings: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [providers, setProviders] = useState<MealCardProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProviders(await loadMealCardProviders());
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (provider: MealCardProvider, enabled: boolean) => {
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setProviders(await invokeIPC<MealCardProvider[]>('set_meal_card_provider_enabled', {
        actorRole, tenantId, code: provider.code, enabled,
      }));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3 max-w-xl">
      <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Yemek Kartları</h2>
      {providers === null && !error ? <p role="status" className="text-sm">Markalar yükleniyor.</p> : null}
      <ul className="divide-y divide-[var(--border)]">
        {providers?.map((provider) => (
          <li key={provider.code}>
            <label className="flex min-h-12 items-center gap-3 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={provider.enabled}
                disabled={!canManage}
                onChange={(event) => void toggle(provider, event.target.checked)}
              />
              <span>{provider.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {error ? <ErrorToast message={error} /> : null}
    </section>
  );
};
