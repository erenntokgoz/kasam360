import { create } from 'zustand';

interface SetupState {
  isSetupComplete: boolean;
  openingBalance: number;
  openingDebts: number;
  openingReceivables: number;
  setSetupComplete: (isComplete: boolean) => void;
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
  setSetupComplete: (isComplete) => set({ isSetupComplete: isComplete }),
  setOpeningData: (data) => set({ ...data }),
}));
