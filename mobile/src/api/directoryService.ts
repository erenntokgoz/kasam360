import apiClient from './client';

export interface DirectoryEntry {
  _id: string;
  name: string;
  type: 'CONTACT' | 'STAFF';
  role?: string;
  totalPaid: number;
  totalBalance: number;
  lastTransactionDate?: string;
}

export const getDirectory = async (type?: 'CONTACT' | 'STAFF'): Promise<DirectoryEntry[]> => {
  const url = type ? `/api/directory?type=${type}` : '/api/directory';
  const response = await apiClient.get<{ success: boolean; data: DirectoryEntry[] }>(url);
  return response.data.data;
};

export const createEntry = async (entry: Partial<DirectoryEntry>): Promise<DirectoryEntry> => {
  const response = await apiClient.post<{ success: boolean; data: DirectoryEntry }>('/api/directory', entry);
  return response.data.data;
};

export const updateEntry = async (id: string, updates: Partial<DirectoryEntry>): Promise<DirectoryEntry> => {
  const response = await apiClient.put<{ success: boolean; data: DirectoryEntry }>(`/api/directory/${id}`, updates);
  return response.data.data;
};

export const deleteEntry = async (id: string): Promise<void> => {
  await apiClient.delete(`/api/directory/${id}`);
};
