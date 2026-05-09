import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';

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
  }) => void;
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

  setOpeningData: (data) => set({ ...data }),
}));
