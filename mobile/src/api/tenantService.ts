import apiClient from './client';

export interface SetupData {
  openingBalance: number;
  openingDebts: number;
  openingReceivables: number;
}

export const updateTenantSetup = async (data: SetupData): Promise<void> => {
  await apiClient.put('/api/tenant/setup', data);
};
