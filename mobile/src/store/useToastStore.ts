import { create } from 'zustand';

export interface ToastState {
  message: string;
  type: 'success' | 'danger' | 'warning' | 'info';
  visible: boolean;
  showToast: (message: string, type?: 'success' | 'danger' | 'warning' | 'info') => void;
  hideToast: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  type: 'info',
  visible: false,
  showToast: (message, type = 'info') => set({ message, type, visible: true }),
  hideToast: () => set({ visible: false }),
}));
