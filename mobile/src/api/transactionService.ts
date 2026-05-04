import apiClient from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TransactionType = 'INCOME' | 'EXPENSE';
export type PaymentMethod = 'CASH' | 'POS' | 'IBAN';

export interface Transaction {
  _id: string;
  tenantId: string;
  type: TransactionType;
  amount: number;           // integer — smallest currency unit (kuruş)
  method: PaymentMethod;
  category: string | null;
  description: string | null;
  syncId?: string;
  transactionDate: string;  // ISO date
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionPayload {
  type: TransactionType;
  amount: number;            // integer cents
  method: PaymentMethod;
  category?: string;
  description?: string;
  transactionDate?: string;  // ISO date — defaults to now on server
  syncId?: string;
}

export interface UpdateTransactionPayload {
  type?: TransactionType;
  amount?: number;            // integer cents
  method?: PaymentMethod;
  category?: string | null;
  description?: string | null;
  transactionDate?: string;  // ISO date
}

export interface TransactionFilters {
  type?: TransactionType | 'ALL';
  startDate?: string;
  endDate?: string;
  categories?: string[];
}

export interface TransactionPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TransactionSummary {
  totalIncome: number;
  totalExpense: number;
  totalDebt: number;
  totalReceivable: number;
  balance: number;
}

interface GetTransactionsResponse {
  success: boolean;
  data: {
    transactions: Transaction[];
    pagination: TransactionPagination;
    summary: TransactionSummary;
  };
}

interface CreateTransactionResponse {
  success: boolean;
  message: string;
  data: Transaction;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Fetches paginated transactions for the authenticated tenant.
 * Results are sorted by transactionDate DESC.
 */
export const getTransactions = async (
  page = 1,
  limit = 20,
  filters?: TransactionFilters,
): Promise<GetTransactionsResponse['data']> => {
  const params: Record<string, string | number> = { page, limit };
  
  if (filters?.type && filters.type !== 'ALL') params.type = filters.type;
  if (filters?.startDate) params.startDate = filters.startDate;
  if (filters?.endDate) params.endDate = filters.endDate;
  if (filters?.categories && filters.categories.length > 0) {
    params.categories = filters.categories.join(',');
  }

  const { data } = await apiClient.get<GetTransactionsResponse>(
    '/api/transactions',
    { params },
  );
  return data.data;
};

/**
 * Creates a new transaction for the authenticated tenant.
 * Amount must be in smallest currency unit (cents/kuruş).
 */
export const createTransaction = async (
  payload: CreateTransactionPayload,
): Promise<Transaction> => {
  const { data } = await apiClient.post<CreateTransactionResponse>(
    '/api/transactions',
    payload,
  );
  return data.data;
};

/**
 * Updates an existing transaction.
 */
export const updateTransaction = async (
  id: string,
  payload: UpdateTransactionPayload,
): Promise<Transaction> => {
  const { data } = await apiClient.put<{ success: boolean; data: Transaction }>(
    `/api/transactions/${id}`,
    payload,
  );
  return data.data;
};

/**
 * Soft-deletes a transaction.
 */
export const deleteTransaction = async (id: string): Promise<void> => {
  await apiClient.delete(`/api/transactions/${id}`);
};
