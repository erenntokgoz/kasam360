import { create } from 'zustand';
import { type FeatureFlags, DEFAULT_FEATURE_FLAGS } from '../types/featureFlags';

interface FeatureStore {
  flags: FeatureFlags;
  isEnabled: (flag: keyof FeatureFlags) => boolean;
  setFlag: (flag: keyof FeatureFlags, enabled: boolean) => void;
}

export const useFeatureStore = create<FeatureStore>((set, get) => ({
  flags: { ...DEFAULT_FEATURE_FLAGS },

  isEnabled: (flag) => {
    // Fail-closed prensibi: tanımsız veya kapalıysa false döner
    return !!get().flags[flag];
  },

  setFlag: (flag, enabled) =>
    set((state) => ({
      flags: { ...state.flags, [flag]: enabled },
    })),
}));
