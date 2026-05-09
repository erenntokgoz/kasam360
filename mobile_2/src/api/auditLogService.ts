import apiClient from './client';

export interface AuditLog {
  _id: string;
  tenantId: string;
  action: 'UPDATE' | 'DELETE';
  entityType: 'TRANSACTION' | 'DEBT';
  entityId: string;
  changes: any;
  createdAt: string;
  updatedAt: string;
}

export const getAuditLogs = async (): Promise<AuditLog[]> => {
  const { data } = await apiClient.get('/api/audit-logs');
  return data.data;
};
