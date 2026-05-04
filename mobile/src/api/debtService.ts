import apiClient from './client';
import type { Transaction } from './transactionService';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DebtType = 'GIVEN' | 'TAKEN';
export type DebtStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface Debt {
  _id: string;
  tenantId: string;
  entityName: string;
  type: DebtType;
  totalAmount: number;      // integer cents/kuruş
  remainingAmount: number;  // integer cents/kuruş
  status: DebtStatus;
  dueDate: string | null;   // ISO date
  syncId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDebtPayload {
  entityName: string;
  type: DebtType;
  totalAmount: number;      // integer cents/kuruş
  dueDate?: string;         // ISO date
  syncId?: string;
}

export interface UpdateDebtPayload {
  entityName?: string;
  type?: DebtType;
  totalAmount?: number;
  remainingAmount?: number;
  dueDate?: string | null;
}

export interface DebtPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DebtSummary {
  given: { total: number; remaining: number; count: number };
  taken: { total: number; remaining: number; count: number };
}

export interface PayDebtResult {
  debt: Debt;
  transaction: Transaction;
}

// ─── Response Shapes ─────────────────────────────────────────────────────────

interface GetDebtsResponse {
  success: boolean;
  data: {
    debts: Debt[];
    pagination: DebtPagination;
    summary: DebtSummary;
  };
}

interface CreateDebtResponse {
  success: boolean;
  message: string;
  data: Debt;
}

interface PayDebtResponse {
  success: boolean;
  message: string;
  data: PayDebtResult;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Fetches paginated debts for the authenticated tenant.
 * Filterable by type (GIVEN/TAKEN) and status.
 */
export const getDebts = async (
  page = 1,
  limit = 20,
  type?: DebtType,
  status?: DebtStatus,
): Promise<GetDebtsResponse['data']> => {
  const params: Record<string, string | number> = { page, limit };
  if (type) params.type = type;
  if (status) params.status = status;

  const { data } = await apiClient.get<GetDebtsResponse>('/api/debts', { params });
  return data.data;
};

/**
 * Creates a new debt record.
 * totalAmount must be in smallest currency unit (cents/kuruş).
 */
export const createDebt = async (payload: CreateDebtPayload): Promise<Debt> => {
  const { data } = await apiClient.post<CreateDebtResponse>('/api/debts', payload);
  return data.data;
};

/**
 * Records a partial or full payment on a debt.
 * Atomically updates the debt and creates a corresponding Transaction.
 *
 * @param debtId - MongoDB ObjectId of the debt
 * @param amount - Payment amount in cents/kuruş
 */
export const payDebt = async (debtId: string, amount: number): Promise<PayDebtResult> => {
  const { data } = await apiClient.post<PayDebtResponse>(`/api/debts/${debtId}/pay`, {
    amount,
  });
  return data.data;
};

/**
 * Updates an existing debt.
 */
export const updateDebt = async (
  id: string,
  payload: UpdateDebtPayload,
): Promise<Debt> => {
  const { data } = await apiClient.put<{ success: boolean; data: Debt }>(
    `/api/debts/${id}`,
    payload,
  );
  return data.data;
};

/**
 * Soft-deletes a debt.
 */
export const deleteDebt = async (id: string): Promise<void> => {
  await apiClient.delete(`/api/debts/${id}`);
};
