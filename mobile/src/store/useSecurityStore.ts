import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SecurityState {
  isLocked: boolean;
  pin: string | null;
  pinLength: 4 | 6 | 8;
  isPinEnabled: boolean;
  lockTimeout: number; // in milliseconds. 0 means immediately.
  isBiometricsEnabled: boolean;
  setLocked: (isLocked: boolean) => void;
  setPin: (pin: string | null) => void;
  setPinLength: (length: 4 | 6 | 8) => void;
  setPinEnabled: (enabled: boolean) => void;
  setLockTimeout: (timeout: number) => void;
  setBiometrics: (enabled: boolean) => void;
  unlock: (pin: string) => boolean;
}

export const useSecurityStore = create<SecurityState>()(
  persist(
    (set, get) => ({
      isLocked: false,
      pin: null,
      pinLength: 4,
      isPinEnabled: false,
      lockTimeout: 0,
      isBiometricsEnabled: false,
      setLocked: (isLocked) => set({ isLocked }),
      setPin: (pin) => set({ pin, isPinEnabled: !!pin }),
      setPinLength: (pinLength) => set({ pinLength }),
      setPinEnabled: (isPinEnabled) => set({ isPinEnabled, isLocked: isPinEnabled }),
      setLockTimeout: (lockTimeout) => set({ lockTimeout }),
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
        pinLength: state.pinLength,
        isPinEnabled: state.isPinEnabled,
        lockTimeout: state.lockTimeout,
        isBiometricsEnabled: state.isBiometricsEnabled,
      }),
    }
  )
);
