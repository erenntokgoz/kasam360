import type { StoreApi } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import { applyPercentBp } from '../lib/numberText';
import { mapBulkPriceResult, mapPriceList } from '../lib/menuWire';
import type { MenuBulkPreviewItem, MenuState, PriceListDto } from '../types/menu';

type AuthContext = { actorRole: string; actorId: string; tenantId: string };
type PriceActions = Pick<
  MenuState,
  'calculateBulkPreview' | 'clearBulkPreview' | 'applyBulkPrice' | 'createPriceList' | 'deletePriceList'
>;

/** Toplu fiyat ve fiyat listesi işlemleri; menü deposunun satır sınırını korumak için ayrıdır. */
export function createMenuPriceActions(
  set: StoreApi<MenuState>['setState'],
  get: StoreApi<MenuState>['getState'],
  getAuthContext: () => AuthContext,
): PriceActions {
  return {
    calculateBulkPreview: (updateType, valueNum, categoryId) => {
      const prods = get().products.filter(
        (p) => !categoryId || (p.categoryId === categoryId && p.isActive)
      );
      const preview: MenuBulkPreviewItem[] = prods.map((p) => {
        let newPriceCents = p.priceCents;
        if (updateType === 'PERCENTAGE') {
          newPriceCents = applyPercentBp(p.priceCents, valueNum);
        } else {
          newPriceCents = Math.max(0, p.priceCents + Math.round(valueNum));
        }
        return {
          id: p.id,
          name: p.name,
          oldPriceCents: p.priceCents,
          newPriceCents,
        };
      });
      set({ bulkPreview: preview });
    },

    clearBulkPreview: () => set({ bulkPreview: [] }),

    applyBulkPrice: async (input) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        const args = {
          categoryId: input.categoryId || undefined,
          productIds: input.categoryId ? undefined : get().products.map((p) => p.id),
          percentBp: input.updateType === 'PERCENTAGE' ? input.value : undefined,
          byCents: input.updateType === 'FIXED_AMOUNT' ? input.value : undefined,
          roundToTens: false,
        };
        const resultWire = await invokeIPC<Parameters<typeof mapBulkPriceResult>[0]>('bulk_update_product_prices', {
          actorRole,
          actorId,
          tenantId,
          args,
        });
        await get().loadCatalog();
        set({ bulkPreview: [] });
        return mapBulkPriceResult(resultWire);
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        set({ busy: false });
      }
    },

    createPriceList: async (name, description) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        const createdWire = await invokeIPC<Parameters<typeof mapPriceList>[0]>('create_price_list_command', {
          actorRole,
          actorId,
          tenantId,
          args: {
            name,
            kind: 'PERAKENDE',
          },
        });
        const created = mapPriceList(createdWire);
        const pl: PriceListDto = {
          ...created,
          description: description || created.description,
        };
        set((state) => ({ priceLists: [...state.priceLists, pl] }));
        return true;
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    deletePriceList: async (priceListId) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        await invokeIPC('delete_price_list_command', { actorRole, actorId, tenantId, id: priceListId });
        set((state) => ({
          priceLists: state.priceLists.filter((pl) => pl.id !== priceListId),
        }));
        return true;
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        set({ busy: false });
      }
    },
  };
}
