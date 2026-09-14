/**
 * Kasam360 - Enterprise Offline-First Synchronization & Distributed Types
 * Architecture: src/data/sync
 */

/**
 * Vector Clock representation: Mapping node/terminal identifiers to logical counters.
 * Used for causal ordering across distributed POS terminals without physical clock reliance.
 */
export type VectorClock = Record<string, number>;

/**
 * Vector clock comparison relation.
 * - EQUAL: Clocks have identical counters across all nodes.
 * - GREATER: Clock A strictly happened after Clock B (A dominates B).
 * - LESS: Clock A strictly happened before Clock B (B dominates A).
 * - CONCURRENT: Clocks branched concurrently (causal conflict requiring domain resolution).
 */
export type VectorClockComparison = 'EQUAL' | 'GREATER' | 'LESS' | 'CONCURRENT';

/**
 * Lifecycle states of an outbox record awaiting upstream synchronization.
 */
export type OutboxRecordStatus = 'PENDING' | 'IN_FLIGHT' | 'COMPLETED' | 'FAILED' | 'CONFLICT';

/**
 * Local Outbox Record mirroring local append-only event log and outbox table.
 */
export interface OutboxRecord<T = unknown> {
  id: string;
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  payload: T;
  vectorClock: VectorClock;
  version: number;
  status: OutboxRecordStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt?: string;
  nextRetryAt?: string;
}

/**
 * Transactional sync payload dispatched sequentially via POST /sync/push.
 */
export interface SyncPayload<T = unknown> {
  syncId: string;
  terminalId: string;
  branchId: string;
  vectorClock: VectorClock;
  records: OutboxRecord<T>[];
  timestamp: string;
  schemaVersion: number;
}

/**
 * Detailed conflict trace for auditability and diagnostic tracking.
 */
export interface ConflictDetail {
  entityId: string;
  entityType: string;
  field?: string;
  localValue: unknown;
  remoteValue: unknown;
  resolvedValue?: unknown;
  resolutionReason: string;
}

/**
 * Strategies employed by the deterministic conflict resolution engine.
 */
export type ConflictResolutionStrategy =
  | 'VECTOR_CLOCK_ORDERED'
  | 'LINE_LEVEL_MERGE'
  | 'COMMUTATIVE_DELTA'
  | 'MANUAL_INTERVENTION_REQUIRED';

/**
 * Result state returned by DomainConflictResolver.
 */
export type ConflictResolutionStatus =
  'RESOLVED' | 'NO_CONFLICT' | 'CONFLICT_DETECTED' | 'UNRESOLVABLE';

/**
 * Comprehensive outcome returned when resolving concurrent domain mutations.
 */
export interface ConflictResolutionResult<T = unknown> {
  resolved: boolean;
  status: ConflictResolutionStatus;
  strategy: ConflictResolutionStrategy;
  winner?: 'LOCAL' | 'REMOTE' | 'MERGED';
  mergedPayload?: T;
  mergedClock: VectorClock;
  conflicts: ConflictDetail[];
  reconciliationNotes: string[];
}

/**
 * Domain Line Item for POS Orders undergoing line-level merge.
 */
export interface OrderLineItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  status: 'ACTIVE' | 'CANCELLED' | 'VOID';
  notes?: string;
  modifiers?: Array<{
    id: string;
    name: string;
    price: number;
    quantity?: number;
  }>;
  vectorClock?: VectorClock;
  updatedAt: string;
}

/**
 * Domain POS Order representation for line-level conflict merge.
 */
export interface OrderSyncPayload {
  id: string;
  branchId: string;
  terminalId: string;
  orderNumber: string;
  tableNumber?: string;
  customerCount?: number;
  status: 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAID' | 'CANCELLED';
  items: OrderLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  vectorClock: VectorClock;
  createdAt: string;
  updatedAt: string;
}

/**
 * Inventory stock delta payload for commutative conflict-free merge.
 */
export interface InventoryDeltaPayload {
  productId: string;
  branchId: string;
  quantityDelta: number;
  reason: string;
  referenceId: string;
  vectorClock: VectorClock;
  timestamp: string;
}

/**
 * Remote server push synchronization response.
 */
export interface SyncPushResponse {
  success: boolean;
  processedRecordIds: string[];
  failedRecordIds?: string[];
  conflicts?: ConflictDetail[];
  serverVectorClock: VectorClock;
  message?: string;
}

/**
 * Network Connectivity Monitor interface.
 */
export interface INetworkStatusListener {
  isOnline(): boolean;
  subscribe(listener: (isOnline: boolean) => void): () => void;
}

/**
 * Outbox Storage Repository interface for persistent and testable storage.
 */
export interface IOutboxRepository {
  getPendingRecords(limit: number): Promise<OutboxRecord[]>;
  markInFlight(recordIds: string[]): Promise<void>;
  markCompleted(recordIds: string[]): Promise<void>;
  markFailed(recordId: string, error: string, nextRetryAt: string): Promise<void>;
  markConflict(recordId: string, error: string): Promise<void>;
  enqueue(
    record: Omit<OutboxRecord, 'id' | 'status' | 'attempts' | 'createdAt'>
  ): Promise<OutboxRecord>;
  getRecordById(id: string): Promise<OutboxRecord | null>;
  getAllRecords(): Promise<OutboxRecord[]>;
}

/**
 * HTTP Client abstraction for POST /sync/push requests.
 */
export interface ISyncHttpClient {
  postSyncPush(url: string, payload: SyncPayload): Promise<SyncPushResponse>;
}
