import { useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';

export type MealCardProviderCode = 'MULTINET' | 'PLUXEE' | 'EDENRED' | 'SETCARD' | 'METROPOL' | 'OTHER';

export interface MealCardProvider {
  code: MealCardProviderCode;
  label: string;
  enabled: boolean;
}

export interface MealCardReconciliationWire {
  rows: { provider: MealCardProviderCode; label: string; totalCents: number; count: number }[];
  totalCents: number;
  count: number;
}

/** Yalnız işletmenin kabul ettiği markalar ödeme ekranında seçilebilir. */
export const acceptedProviders = (providers: MealCardProvider[]) => providers.filter((provider) => provider.enabled);

export function loadMealCardProviders(): Promise<MealCardProvider[]> {
  const { actorRole, tenantId } = sessionArgs();
  return invokeIPC<MealCardProvider[]>('list_meal_card_providers', { actorRole, tenantId });
}

/** Yemek kartı sekmesi açıldığında markaları okur; okunamazsa hata metni döner, liste boş kalır. */
export function useMealCardProviders(active: boolean) {
  const [providers, setProviders] = useState<MealCardProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    setError(null);
    loadMealCardProviders()
      .then((rows) => { if (current) setProviders(rows); })
      .catch((caught) => { if (current) setError(String(caught)); });
    return () => { current = false; };
  }, [active]);

  return { providers, error };
}
