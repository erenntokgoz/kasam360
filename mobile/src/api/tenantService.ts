import apiClient from './client';

export interface SetupData {
  openingBalance: number;
  openingDebts: number;
  openingReceivables: number;
}

export const updateTenantSetup = async (data: SetupData): Promise<void> => {
  await apiClient.put('/api/tenant/setup', data);
};

export const updateDeviceToken = async (deviceToken: string): Promise<void> => {
  await apiClient.put('/api/tenant/device-token', { deviceToken });
};

export const triggerDueNotifications = async (): Promise<void> => {
  await apiClient.post('/api/tenant/trigger-notifications');
};
