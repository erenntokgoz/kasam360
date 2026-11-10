import { create } from 'zustand';
import type {
  AwaitingDocument,
  DirectoryContact,
  DirectoryStatement,
  DirectoryType,
  LedgerDebt,
  OperationOutcome,
} from '../types/ledger';
import { invokeIPC } from '../services/tauriClient';
import { useAuthStore } from './authStore';
import { errorText } from '../lib/cariInput';
import { utcOffsetMinutes } from '../lib/dateRange';

export interface CardInput {
  name: string;
  type: DirectoryType;
  phone?: string;
  email?: string;
  taxNo?: string;
  taxOffice?: string;
  address?: string;
  creditLimitCents?: number;
  notes?: string;
}

export interface PaymentInput {
  operationId: string;
  debtId: string;
  expectedVersion: number;
  amountCents: number;
  paymentMethod: 'CASH' | 'CREDIT_CARD' | 'BANK_TRANSFER';
  notes?: string;
}

export interface OpenDebtInput {
  operationId: string;
  directoryId: string;
  type: 'GIVEN' | 'TAKEN';
  totalAmountCents: number;
  dueDate?: string;
  description?: string;
}

export interface DocumentInput {
  operationId: string;
  purchaseOrderId: string;
  documentNo: string;
  documentTotalCents: number;
  dueDate?: string;
  differenceReason?: string;
}

interface CariStore {
  cards: DirectoryContact[];
  debts: LedgerDebt[];
  statement: DirectoryStatement | null;
  awaiting: AwaitingDocument[];
  loadError: string | null;
  loadCards: (type: DirectoryType, search: string) => Promise<void>;
  loadCardDetail: (directoryId: string, from: string, to: string) => Promise<void>;
  loadAwaiting: () => Promise<void>;
  findSimilar: (type: DirectoryType, name: string, phone?: string) => Promise<DirectoryContact[]>;
  createCard: (input: CardInput, operationId: string, allowSimilar: boolean) => Promise<DirectoryContact>;
  updateCard: (card: DirectoryContact, input: Pick<CardInput, 'name' | 'phone' | 'taxNo' | 'creditLimitCents'>, operationId: string) => Promise<DirectoryContact>;
  deleteCard: (cardId: string, operationId: string) => Promise<void>;
  openDebt: (input: OpenDebtInput) => Promise<void>;
  payDebt: (input: PaymentInput) => Promise<void>;
  approveDocument: (input: DocumentInput) => Promise<void>;
  queryOperation: (operationId: string) => Promise<OperationOutcome>;
}

/** Komutlar rol ve kiracı olmadan reddedilir; oturumsuz çağrı baştan durur. */
export function sessionArgs() {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Oturum açık değil.');
  return { actorRole: user.role, actorId: user.userId, tenantId: user.tenantId };
}

// Sekme ya da arama değişince geç gelen eski liste yeni listeyi ezmesin.
let cardsRequest = 0;
let detailRequest = 0;
let awaitingRequest = 0;

export const useCariStore = create<CariStore>((set) => ({
  cards: [],
  debts: [],
  statement: null,
  awaiting: [],
  loadError: null,

  loadCards: async (type, search) => {
    const request = ++cardsRequest;
    try {
      const { actorRole, tenantId } = sessionArgs();
      const cards = await invokeIPC<DirectoryContact[]>('get_directories', {
        actorRole,
        tenantId,
        directoryType: type,
        search: search.trim() || undefined,
      });
      if (request === cardsRequest) set({ cards, loadError: null });
    } catch (error) {
      if (request === cardsRequest) set({ cards: [], loadError: errorText(error) });
    }
  },

  loadCardDetail: async (directoryId, from, to) => {
    const request = ++detailRequest;
    try {
      const { actorRole, tenantId } = sessionArgs();
      const [debts, statement] = await Promise.all([
        invokeIPC<LedgerDebt[]>('get_debts', { actorRole, tenantId, directoryId }),
        invokeIPC<DirectoryStatement>('get_directory_statement', {
          directoryId,
          from,
          to,
          utcOffsetMinutes: utcOffsetMinutes(),
          actorRole,
          tenantId,
        }),
      ]);
      if (request === detailRequest) set({ debts, statement, loadError: null });
    } catch (error) {
      if (request === detailRequest) set({ debts: [], statement: null, loadError: errorText(error) });
    }
  },

  loadAwaiting: async () => {
    const request = ++awaitingRequest;
    try {
      const { actorRole, tenantId } = sessionArgs();
      const awaiting = await invokeIPC<AwaitingDocument[]>('get_awaiting_supplier_documents', {
        actorRole,
        tenantId,
      });
      if (request === awaitingRequest) set({ awaiting, loadError: null });
    } catch (error) {
      if (request === awaitingRequest) set({ awaiting: [], loadError: errorText(error) });
    }
  },

  findSimilar: async (type, name, phone) => {
    const { actorRole, tenantId } = sessionArgs();
    return invokeIPC<DirectoryContact[]>('find_similar_directories', {
      actorRole,
      tenantId,
      directoryType: type,
      name,
      phone,
    });
  },

  createCard: async (input, operationId, allowSimilar) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    return invokeIPC<DirectoryContact>('create_directory', {
      actorRole,
      actorId,
      payload: { ...input, operationId, allowSimilar, tenantId },
    });
  },

  updateCard: async (card, input, operationId) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    return invokeIPC<DirectoryContact>('update_directory', {
      actorRole,
      actorId,
      payload: {
        operationId,
        id: card.id,
        tenantId,
        name: input.name,
        phone: input.phone ?? null,
        email: card.email ?? null,
        taxNo: input.taxNo ?? null,
        taxOffice: card.taxOffice ?? null,
        address: card.address ?? null,
        creditLimitCents: input.creditLimitCents ?? card.creditLimitCents,
        notes: card.notes ?? null,
      },
    });
  },

  deleteCard: async (cardId, operationId) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC('delete_directory', { id: cardId, operationId, tenantId, actorRole, actorId });
  },

  openDebt: async (input) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC('create_debt', {
      actorRole,
      actorId,
      payload: { ...input, tenantId, isCash: false },
    });
  },

  payDebt: async (input) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC('pay_debt', { actorRole, payload: { ...input, tenantId, actorId } });
  },

  approveDocument: async (input) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC('approve_supplier_document', {
      actorRole,
      payload: { ...input, tenantId, actorId },
    });
  },

  queryOperation: async (operationId) => {
    const { actorRole, tenantId } = sessionArgs();
    return invokeIPC<OperationOutcome>('get_operation_result', {
      operationId,
      actorRole,
      tenantId,
    });
  },
}));
