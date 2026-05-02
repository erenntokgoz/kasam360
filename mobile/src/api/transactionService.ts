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
  type?: TransactionType,
): Promise<GetTransactionsResponse['data']> => {
  const params: Record<string, string | number> = { page, limit };
  if (type) params.type = type;

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
