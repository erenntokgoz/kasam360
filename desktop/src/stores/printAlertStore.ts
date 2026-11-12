import { create } from 'zustand';

// Fiş basılamadığında sipariş yine de kayıtlıdır; uyarı geçici bildirim olmaz,
// kullanıcı kapatana kadar salon ve adisyon ekranında görünür.
interface PrintAlertStore {
  problems: string[];
  report: (problems: string[]) => void;
  dismiss: () => void;
}

export const usePrintAlertStore = create<PrintAlertStore>((set) => ({
  problems: [],
  report: (problems) =>
    set((state) => ({ problems: [...new Set([...state.problems, ...problems])] })),
  dismiss: () => set({ problems: [] }),
}));
