import type { StoreApi } from 'zustand';
import { invokeIPC } from '../services/tauriClient';
import type { MenuState, ModifierGroupDto, ModifierOptionDto } from '../types/menu';

type AuthContext = { actorRole: string; actorId: string; tenantId: string };
type ModifierActions = Pick<MenuState, 'createModifierGroup' | 'deleteModifierGroup' | 'addModifierOption' | 'deleteModifierOption'>;

export function createMenuModifierActions(
  set: StoreApi<MenuState>['setState'],
  getAuthContext: () => AuthContext,
): ModifierActions {
  return {
    createModifierGroup: async (name, minSelections, maxSelections, isRequired, onCreated) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        if (!name.trim() || !Number.isSafeInteger(minSelections) || !Number.isSafeInteger(maxSelections) || minSelections < 0 || maxSelections < 1 || maxSelections < minSelections || (isRequired && minSelections < 1)) {
          throw new Error('Grup adı ve geçerli tam sayı seçim sınırları gerekli.');
        }
        set({ busy: true, error: null });
        const createdId = await invokeIPC<string>('create_modifier_group', {
          actorRole, actorId, tenantId, name, minSelections,
          maxSelections, isRequired,
        });
        if (typeof createdId !== 'string' || !createdId) throw new Error('Grup kimliği alınamadı.');
        const newGroup: ModifierGroupDto = {
          id: createdId, name, isRequired, minSelections, maxSelections, options: [],
        };
        set((state) => ({ modifierGroups: [...state.modifierGroups, newGroup] }));
        onCreated?.(newGroup);
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

    deleteModifierOption: async (optionId) => {
      try {
        const { actorRole, actorId, tenantId } = getAuthContext();
        set({ busy: true, error: null });
        await invokeIPC('delete_modifier_option', { actorRole, actorId, tenantId, optionId });
        set((state) => ({
          modifierGroups: state.modifierGroups.map((group) => ({
            ...group,
            options: group.options.filter((option) => option.id !== optionId),
          })),
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
