import { create } from 'zustand';
import apiClient from '../api/client';

interface DashboardState {
  summary: any;
  loading: boolean;
  fetchDashboard: () => Promise<void>;
}
export const useDashboardStore = create<DashboardState>((set) => ({
  summary: null,
  loading: false,
  fetchDashboard: async () => {
    set({ loading: true });
    try {
      const res = await apiClient.get('/api/transactions?limit=1'); // Geçici özet endpoint'i
      set({ summary: res.data.data.summary, loading: false });
    } catch (error) {
      set({ loading: false });
    }
  }
}));
