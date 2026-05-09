import { create } from 'zustand';

export interface LogEntry {
  id: string;
  timestamp: string;
  action: string;
  type: 'info' | 'success' | 'error';
}

interface LogStore {
  logs: LogEntry[];
  addLog: (action: string, type?: 'info' | 'success' | 'error') => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: [],
  addLog: (action, type = 'info') =>
    set((state) => {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString('tr-TR'),
        action,
        type,
      };
      // Keep latest 100 logs
      return { logs: [newLog, ...state.logs].slice(0, 100) };
    }),
  clearLogs: () => set({ logs: [] }),
}));
