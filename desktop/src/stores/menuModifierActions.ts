import type { StoreApi } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import type { Menu360State, ModifierGroupDto, ModifierOptionDto } from '../types/menu360';

type AuthContext = { actorRole: string; actorId: string; tenantId: string };
type ModifierActions = Pick<Menu360State, 'createModifierGroup' | 'deleteModifierGroup' | 'addModifierOption'>;

export function createMenuModifierActions(
  set: StoreApi<Menu360State>['setState'],
  getAuthContext: () => AuthContext,
): ModifierActions {
  return {
    createModifierGroup: async (name, minSelections, maxSelections, isRequired) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        const createdId = await invokeIPC<string>('create_modifier_group', {
          actorRole, actorId, tenantId, name, minSelections,
          maxSelections: maxSelections || 1, isRequired,
        });
        if (typeof createdId !== 'string' || !createdId) throw new Error('Grup kimliği alınamadı.');
        const newGroup: ModifierGroupDto = {
          id: createdId, name, isRequired, minSelections, maxSelections, options: [],
        };
        set((state) => ({ modifierGroups: [...state.modifierGroups, newGroup] }));
        return true;
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    deleteModifierGroup: async (groupId) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        await invokeIPC('delete_modifier_group', { actorRole, actorId, tenantId, groupId });
        set((state) => ({
          modifierGroups: state.modifierGroups.filter((group) => group.id !== groupId),
          productModifierGroupIds: state.productModifierGroupIds.filter((id) => id !== groupId),
        }));
        return true;
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    addModifierOption: async (groupId, name, priceCents) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        const createdId = await invokeIPC<string>('add_modifier_option', {
          actorRole, actorId, tenantId, groupId, name, priceCents,
        });
        if (typeof createdId !== 'string' || !createdId) throw new Error('Seçenek kimliği alınamadı.');
        const newOption: ModifierOptionDto = {
          id: createdId, modifierGroupId: groupId, name, priceCents,
        };
        set((state) => ({
          modifierGroups: state.modifierGroups.map((group) =>
            group.id === groupId ? { ...group, options: [...group.options, newOption] } : group
          ),
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
