import type { StoreApi } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import type { MenuState } from '../types/menu';

type AuthContext = {
  actorRole: string;
  actorId: string;
  tenantId: string;
  activeModules: string[];
};
type RecipeActions = Pick<MenuState, 'createRecipe' | 'deactivateRecipe'>;

export function createMenuRecipeActions(
  set: StoreApi<MenuState>['setState'],
  get: StoreApi<MenuState>['getState'],
  getAuthContext: () => AuthContext,
): RecipeActions {
  return {
    createRecipe: async (input) => {
      try {
        const { actorRole, actorId, tenantId, activeModules } = getAuthContext();
        if (get().selectedProductId !== input.productId || input.items.length === 0) {
          throw new Error('Reçete için geçerli ürün ve malzeme seçin.');
        }
        set({ busy: true, error: null });
        await invokeIPC('create_recipe_command', {
          actorRole, actorId, tenantId, activeModules, args: input,
        });
        await get().loadProductRecipe(input.productId);
        return true;
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    deactivateRecipe: async (productId, recipeId) => {
      try {
        const { actorRole, actorId, tenantId, activeModules } = getAuthContext();
        if (get().selectedProductId !== productId || get().productRecipe?.recipeId !== recipeId) {
          throw new Error('Pasife alınacak reçete bulunamadı.');
        }
        set({ busy: true, error: null });
        await invokeIPC('deactivate_recipe_command', {
          actorRole, actorId, tenantId, activeModules, args: { recipeId },
        });
        if (get().selectedProductId === productId) set({ productRecipe: null });
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
