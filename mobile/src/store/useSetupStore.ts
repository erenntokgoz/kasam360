import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';
import { updateTenantSetup } from '../api/tenantService';

interface SetupState {
  isSetupComplete: boolean;
  openingBalance: number;
  openingDebts: number;
  openingReceivables: number;
  hydrateSetup: () => Promise<void>;
  setSetupComplete: (isComplete: boolean) => Promise<void>;
  setOpeningData: (data: {
    openingBalance: number;
    openingDebts: number;
    openingReceivables: number;
  }) => Promise<void>;
}

export const useSetupStore = create<SetupState>((set) => ({
  isSetupComplete: false,
  openingBalance: 0,
  openingDebts: 0,
  openingReceivables: 0,

  hydrateSetup: async () => {
    const stored = await getItem(StorageKeys.SETUP_COMPLETE);
    if (stored === 'true') {
      set({ isSetupComplete: true });
    }
  },

  setSetupComplete: async (isComplete) => {
    await setItem(StorageKeys.SETUP_COMPLETE, String(isComplete));
    set({ isSetupComplete: isComplete });
  },

  setOpeningData: async (data) => {
    try {
      await updateTenantSetup({
        openingBalance: Math.round(data.openingBalance * 100),
        openingDebts: Math.round(data.openingDebts * 100),
        openingReceivables: Math.round(data.openingReceivables * 100),
      });
      set({ ...data });
    } catch (error) {
      console.error('Failed to update opening data on backend', error);
      // Still set locally to allow user to proceed
      set({ ...data });
    }
  },
}));
