import { useEffect, useState } from 'react';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';

const cache = new Map<string, number | null>();

/** Reçetesi olmayan ürünün maliyeti yoktur; kart bu durumda kâr göstermez. */
export function useProductCost(productId: string): number | null {
  const [cost, setCost] = useState<number | null>(cache.get(productId) ?? null);

  useEffect(() => {
    if (cache.has(productId)) return;
    const user = useAuthStore.getState().user;
    if (!user) return;
    invokeIPC<{ totalCostCents: number | null }>('get_recipe_cost', {
      actorRole: user.role,
      tenantId: user.tenantId,
      activeModules: user.activeModules ?? [],
      args: { productId },
    })
      .then((result) => {
        cache.set(productId, result.totalCostCents);
        setCost(result.totalCostCents);
      })
      .catch(() => cache.set(productId, null));
  }, [productId]);

  return cost;
}
