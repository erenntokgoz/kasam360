import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SecurityState {
  isLocked: boolean;
  pin: string | null;
  isBiometricsEnabled: boolean;
  setLocked: (isLocked: boolean) => void;
  setPin: (pin: string | null) => void;
  setBiometrics: (enabled: boolean) => void;
  unlock: (pin: string) => boolean;
}

export const useSecurityStore = create<SecurityState>()(
  persist(
    (set, get) => ({
      isLocked: false,
      pin: null,
      isBiometricsEnabled: false,
      setLocked: (isLocked) => set({ isLocked }),
      setPin: (pin) => set({ pin }),
      setBiometrics: (enabled) => set({ isBiometricsEnabled: enabled }),
      unlock: (pin) => {
        const currentPin = get().pin;
        if (currentPin === pin) {
          set({ isLocked: false });
          return true;
        }
        return false;
      },
    }),
    {
      name: 'security-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pin: state.pin,
        isBiometricsEnabled: state.isBiometricsEnabled,
      }),
    }
  )
);
