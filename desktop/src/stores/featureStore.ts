import { create } from 'zustand';
import { type FeatureFlags, DEFAULT_FEATURE_FLAGS } from '../types/featureFlags';

interface FeatureStore {
  flags: FeatureFlags;
  isEnabled: (flag: keyof FeatureFlags) => boolean;
  setFlag: (flag: keyof FeatureFlags, enabled: boolean) => void;
  setModules: (modules: string[]) => void;
}

const featureKeys = Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[];
const closedFlags = featureKeys.reduce((flags, key) => {
  flags[key] = false;
  return flags;
}, { ...DEFAULT_FEATURE_FLAGS });

export const useFeatureStore = create<FeatureStore>((set, get) => ({
  flags: { ...closedFlags },

  isEnabled: (flag) => {
    // Fail-closed prensibi: tanımsız veya kapalıysa false döner
    return !!get().flags[flag];
  },

  setFlag: (flag, enabled) =>
    set((state) => ({
      flags: { ...state.flags, [flag]: enabled },
    })),
  setModules: (modules) => set({
    flags: featureKeys.reduce((flags, key) => {
      flags[key] = modules.includes(key);
      return flags;
    }, { ...closedFlags }),
  }),
}));
