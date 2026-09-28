/**
 * Strict Interfaces for Cryptographic Audit Ledger & Tamper-Proof Storage
 * Kasam360 Enterprise Security & Cryptographic Ledger Layer
 */

export interface AuditEntry {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly action: string;
  readonly resource_id: string;
  readonly payload: Record<string, unknown>;
  readonly previous_hash: string;
  readonly current_hash: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateAuditEntryInput {
  readonly id?: string;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly action: string;
  readonly resource_id: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp?: string;
  readonly metadata?: Record<string, unknown>;
}

export type HashChainValidationErrorType =
  | 'GENESIS_MISMATCH'
  | 'BROKEN_LINK'
  | 'PAYLOAD_TAMPERED'
  | 'SEQUENCE_GAP'
  | 'INVALID_TIMESTAMP_ORDER'
  | 'MALFORMED_HASH';

export interface HashChainValidationError {
  readonly type: HashChainValidationErrorType;
  readonly index: number;
  readonly entryId: string;
  readonly sequence: number;
  readonly expected: string | number;
  readonly actual: string | number;
  readonly message: string;
}

export interface HashChainValidationResult {
  readonly isValid: boolean;
  readonly totalEntries: number;
  readonly verifiedEntries: number;
  readonly errors: readonly HashChainValidationError[];
}

export type LedgerExportFormat = 'JSON' | 'CSV' | 'NDJSON' | 'SECURE_ARCHIVE';

export interface LedgerExportOptions {
  readonly format: LedgerExportFormat;
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly actorId?: string;
  readonly action?: string;
  readonly includeMetadata?: boolean;
  readonly prettyPrint?: boolean;
}

export interface LedgerExportResult {
  readonly format: LedgerExportFormat;
  readonly exportedAt: string;
  readonly exportedByRole: string;
  readonly exportedByActorId: string;
  readonly totalRecords: number;
  readonly content: string;
  readonly checksumSha256: string;
}

export type LedgerRole =
  'Auditor' | 'OWNER' | 'System' | 'Admin' | 'MANAGER' | 'WAITER' | 'KITCHEN';

export interface LedgerPrincipal {
  readonly userId: string;
  readonly role: LedgerRole | string;
}

export type LedgerPermission =
  'ledger:select' | 'ledger:export' | 'ledger:verify' | 'ledger:append';
