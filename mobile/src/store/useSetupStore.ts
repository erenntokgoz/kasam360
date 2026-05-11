import { create } from 'zustand';
import { getItem, setItem, StorageKeys } from '../utils/storage';
import { updateTenantSetup } from '../api/tenantService';

interface SetupState {
  isSetupComplete: boolean;
  hasSeenOnboarding: boolean;
  openingBalance: number;
  openingDebts: number;
  openingReceivables: number;
  hydrateSetup: () => Promise<void>;
  setSetupComplete: (isComplete: boolean) => Promise<void>;
  setOnboardingSeen: () => Promise<void>;
  setOpeningData: (data: {
    openingBalance: number;
    openingDebts: number;
    openingReceivables: number;
  }) => Promise<void>;
  reset: () => void;
}

const initialState = {
  isSetupComplete: false,
  hasSeenOnboarding: false,
  openingBalance: 0,
  openingDebts: 0,
  openingReceivables: 0,
};

export const useSetupStore = create<SetupState>((set) => ({
  ...initialState,

  /**
   * Hydrates both the setup-complete flag and the onboarding-seen flag
   * from AsyncStorage. Called once at app startup (before navigation mounts).
   */
  hydrateSetup: async () => {
    const [setupStored, onboardingStored] = await Promise.all([
      getItem(StorageKeys.SETUP_COMPLETE),
      getItem(StorageKeys.ONBOARDING_SEEN),
    ]);
    set({
      isSetupComplete: setupStored === 'true',
      hasSeenOnboarding: onboardingStored === 'true',
    });
  },

  setSetupComplete: async (isComplete) => {
    await setItem(StorageKeys.SETUP_COMPLETE, String(isComplete));
    set({ isSetupComplete: isComplete });
  },

  /**
   * Marks the onboarding as seen — persisted to AsyncStorage so it
   * survives app restarts and login/logout cycles.
   */
  setOnboardingSeen: async () => {
    await setItem(StorageKeys.ONBOARDING_SEEN, 'true');
    set({ hasSeenOnboarding: true });
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

  reset: () => set(initialState),
}));
