import {
  AuditEntry,
  CreateAuditEntryInput,
  HashChainValidationResult,
  LedgerExportOptions,
  LedgerExportResult,
  LedgerPrincipal,
  LedgerRole,
} from '../../../domain/entities/ledger/types';
import {
  calculateSha256,
  canonicalJsonStringify,
  HashChainBuilder,
} from '../../../domain/entities/ledger/HashChainBuilder';

/**
 * Thrown when any mutation (UPDATE, DELETE, TRUNCATE) is attempted on the audit ledger.
 */
export class LedgerImmutabilityViolationError extends Error {
  public readonly name = 'LedgerImmutabilityViolationError';

  constructor(operation: 'UPDATE' | 'DELETE' | 'TRUNCATE' | string, reason?: string) {
    super(
      `IMMUTABILITY MANDATE VIOLATION: Operation '${operation}' is strictly prohibited on the immutable audit ledger.${
        reason ? ` Reason: ${reason}` : ''
      }`
    );
    Object.setPrototypeOf(this, LedgerImmutabilityViolationError.prototype);
  }
}

/**
 * Thrown when an actor attempts an action prohibited by the strict ledger role boundary.
 */
export class LedgerRoleAccessDeniedError extends Error {
  public readonly name = 'LedgerRoleAccessDeniedError';

  constructor(role: string, action: string, reason?: string) {
    super(
      `LEDGER ACCESS DENIED: Role '${role}' lacks authority to perform '${action}'.${
        reason ? ` ${reason}` : ''
      }`
    );
    Object.setPrototypeOf(this, LedgerRoleAccessDeniedError.prototype);
  }
}

export interface LedgerQueryFilter {
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly actorId?: string;
  readonly action?: string;
  readonly resourceId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ILedgerStorageDriver {
  insert(entry: AuditEntry): Promise<void>;
  query(filter?: LedgerQueryFilter): Promise<readonly AuditEntry[]>;
  findById(id: string): Promise<AuditEntry | null>;
  findBySequence(sequence: number): Promise<AuditEntry | null>;
  getLatest(): Promise<AuditEntry | null>;
  count(): Promise<number>;
  executeSql?(sql: string, params?: readonly unknown[]): Promise<unknown>;
}

/**
 * In-memory storage driver enforcing SQLite-grade table constraints,
 * sequence validation, and trigger-level aborts on mutations.
 */
export class InMemoryLedgerStorageDriver implements ILedgerStorageDriver {
  private rows: AuditEntry[] = [];
  private readonly idIndex: Map<string, AuditEntry> = new Map();
  private readonly sequenceIndex: Map<number, AuditEntry> = new Map();
  private readonly hashIndex: Map<string, AuditEntry> = new Map();

  public async insert(entry: AuditEntry): Promise<void> {
    if (this.idIndex.has(entry.id)) {
      throw new Error(`UNIQUE constraint failed: audit_ledger.id '${entry.id}'`);
    }
    if (this.sequenceIndex.has(entry.sequence)) {
      throw new Error(`UNIQUE constraint failed: audit_ledger.sequence '${entry.sequence}'`);
    }
    if (this.hashIndex.has(entry.current_hash)) {
      throw new Error(
        `UNIQUE constraint failed: audit_ledger.current_hash '${entry.current_hash}'`
      );
    }
    if (entry.sequence <= 0) {
      throw new Error('INTEGRITY VIOLATION: Sequence must be a positive integer starting at 1.');
    }
    if (entry.current_hash.length !== 64 || entry.previous_hash.length !== 64) {
      throw new Error('INTEGRITY VIOLATION: Hash length must be exactly 64 hex characters.');
    }

    this.rows.push(entry);
    this.idIndex.set(entry.id, entry);
    this.sequenceIndex.set(entry.sequence, entry);
    this.hashIndex.set(entry.current_hash, entry);
  }

  public async query(filter?: LedgerQueryFilter): Promise<readonly AuditEntry[]> {
    let result = [...this.rows];

    if (filter) {
      if (filter.fromSequence !== undefined) {
        result = result.filter((r) => r.sequence >= filter.fromSequence!);
      }
      if (filter.toSequence !== undefined) {
        result = result.filter((r) => r.sequence <= filter.toSequence!);
      }
      if (filter.startDate !== undefined) {
        const start = new Date(filter.startDate).getTime();
        result = result.filter((r) => new Date(r.timestamp).getTime() >= start);
      }
      if (filter.endDate !== undefined) {
        const end = new Date(filter.endDate).getTime();
        result = result.filter((r) => new Date(r.timestamp).getTime() <= end);
      }
      if (filter.actorId !== undefined) {
        result = result.filter((r) => r.actor_id === filter.actorId);
      }
      if (filter.action !== undefined) {
        result = result.filter((r) => r.action === filter.action);
      }
      if (filter.resourceId !== undefined) {
        result = result.filter((r) => r.resource_id === filter.resourceId);
      }
      if (filter.offset !== undefined && filter.offset > 0) {
        result = result.slice(filter.offset);
      }
      if (filter.limit !== undefined && filter.limit >= 0) {
        result = result.slice(0, filter.limit);
      }
    }

    return result;
  }

  public async findById(id: string): Promise<AuditEntry | null> {
    return this.idIndex.get(id) ?? null;
  }

  public async findBySequence(sequence: number): Promise<AuditEntry | null> {
    return this.sequenceIndex.get(sequence) ?? null;
  }

  public async getLatest(): Promise<AuditEntry | null> {
    return this.rows.length > 0 ? this.rows[this.rows.length - 1] : null;
  }

  public async count(): Promise<number> {
    return this.rows.length;
  }

  /**
   * Simulates SQLite trigger execution for raw SQL statements.
   */
  public async executeSql(sql: string): Promise<unknown> {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('UPDATE')) {
      throw new LedgerImmutabilityViolationError(
        'UPDATE',
        'Trigger trg_audit_ledger_prevent_update aborted execution.'
      );
    }
    if (trimmed.startsWith('DELETE')) {
      throw new LedgerImmutabilityViolationError(
        'DELETE',
        'Trigger trg_audit_ledger_prevent_delete aborted execution.'
      );
    }
    if (trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE')) {
      throw new LedgerImmutabilityViolationError('TRUNCATE', 'Database truncation is forbidden.');
    }
    return true;
  }
}

/**
 * Immutable Append-Only Ledger Repository
 * Enforces database-level triggers and role-based access isolation.
 *
 * Role Isolation Rules:
 * - Auditor & Owner: strictly read-only and export capabilities (SELECT, export). ZERO write/mutation privileges.
 * - System: automated engine privileged to append verified hash-chained entries.
 * - Waiter & Kitchen & others: strictly forbidden from all ledger operations.
 */
export class ImmutableLedgerRepository {
  public static readonly SQL_TRIGGERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    sequence INTEGER NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    current_hash TEXT NOT NULL UNIQUE,
    metadata TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_update
BEFORE UPDATE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Updates to audit_ledger are strictly prohibited.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_ledger_prevent_delete
BEFORE DELETE ON audit_ledger
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY MANDATE VIOLATION: Deletions from audit_ledger are strictly prohibited.');
END;
`.trim();

  private readonly driver: ILedgerStorageDriver;

  constructor(driver: ILedgerStorageDriver = new InMemoryLedgerStorageDriver()) {
    this.driver = driver;
  }

  /**
   * Appends an audit entry to the immutable ledger.
   * STRICT ROLE ISOLATION: Auditor and Owner roles are restricted to READ-ONLY.
   * Only automated System pipeline can append new entries.
   */
  public async append(
    input: CreateAuditEntryInput,
    principal: LedgerPrincipal
  ): Promise<AuditEntry> {
    this.assertWritePrivileges(principal);

    const latest = await this.driver.getLatest();
    const entry = HashChainBuilder.buildNextEntry(input, latest);

    await this.driver.insert(entry);
    return entry;
  }

  /**
   * Retrieves audit entries matching the query filter.
   * Available to Auditor, Owner, System, and Admin.
   */
  public async getEntries(
    filter: LedgerQueryFilter | undefined,
    principal: LedgerPrincipal
  ): Promise<readonly AuditEntry[]> {
    this.assertReadPrivileges(principal);
    return this.driver.query(filter);
  }

  /**
   * Retrieves a specific entry by its unique identifier.
   */
  public async getEntryById(id: string, principal: LedgerPrincipal): Promise<AuditEntry | null> {
    this.assertReadPrivileges(principal);
    return this.driver.findById(id);
  }

  /**
   * Retrieves a specific entry by sequence number.
   */
  public async getEntryBySequence(
    sequence: number,
    principal: LedgerPrincipal
  ): Promise<AuditEntry | null> {
    this.assertReadPrivileges(principal);
    return this.driver.findBySequence(sequence);
  }

  /**
   * Retrieves the current tip (latest entry) of the ledger.
   */
  public async getLatestEntry(principal: LedgerPrincipal): Promise<AuditEntry | null> {
    this.assertReadPrivileges(principal);
    return this.driver.getLatest();
  }

  /**
   * Verifies the cryptographic integrity of the entire persisted ledger chain.
   */
  public async validateLedgerIntegrity(
    principal: LedgerPrincipal
  ): Promise<HashChainValidationResult> {
    this.assertReadPrivileges(principal);
    const allEntries = await this.driver.query();
    return HashChainBuilder.verifyChain(allEntries);
  }

  /**
   * Exports ledger entries in secure formats (JSON, CSV, NDJSON, SECURE_ARCHIVE).
   * Authorized for Auditor and Owner roles with tamper-evident checksums.
   */
  public async exportLedger(
    options: LedgerExportOptions,
    principal: LedgerPrincipal
  ): Promise<LedgerExportResult> {
    this.assertExportPrivileges(principal);

    const entries = await this.driver.query({
      fromSequence: options.fromSequence,
      toSequence: options.toSequence,
      startDate: options.startDate,
      endDate: options.endDate,
      actorId: options.actorId,
      action: options.action,
    });

    let content: string;
    switch (options.format) {
      case 'JSON':
        content = options.prettyPrint ? JSON.stringify(entries, null, 2) : JSON.stringify(entries);
        break;

      case 'NDJSON':
        content = entries.map((e) => JSON.stringify(e)).join('\n');
        break;

      case 'CSV':
        content = this.formatAsCsv(entries);
        break;

      case 'SECURE_ARCHIVE': {
        const integrity = HashChainBuilder.verifyChain(entries);
        const archivePayload = {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          exportedBy: {
            userId: principal.userId,
            role: principal.role,
          },
          totalRecords: entries.length,
          integrityCheck: {
            isValid: integrity.isValid,
            verifiedCount: integrity.verifiedEntries,
            errors: integrity.errors,
          },
          chainGenesis: entries.length > 0 ? entries[0].previous_hash : null,
          chainTip: entries.length > 0 ? entries[entries.length - 1].current_hash : null,
          entries,
        };
        content = options.prettyPrint
          ? JSON.stringify(archivePayload, null, 2)
          : JSON.stringify(archivePayload);
        break;
      }

      default:
        throw new Error(`Unsupported export format: ${(options as { format: string }).format}`);
    }

    const checksumSha256 = calculateSha256(content);

    return {
      format: options.format,
      exportedAt: new Date().toISOString(),
      exportedByRole: principal.role,
      exportedByActorId: principal.userId,
      totalRecords: entries.length,
      content,
      checksumSha256,
    };
  }

  /**
   * Direct mutation prevention: UPDATE is strictly prohibited by SQLite trigger mandate.
   */
  public update(): never {
    throw new LedgerImmutabilityViolationError(
      'UPDATE',
      'The audit ledger is strictly append-only. SQLite triggers reject any modification.'
    );
  }

  /**
   * Direct deletion prevention: DELETE is strictly prohibited by SQLite trigger mandate.
   */
  public delete(): never {
    throw new LedgerImmutabilityViolationError(
      'DELETE',
      'The audit ledger is strictly append-only. SQLite triggers reject any removal.'
    );
  }

  /**
   * Direct purge prevention: TRUNCATE/CLEAR is strictly prohibited.
   */
  public clear(): never {
    throw new LedgerImmutabilityViolationError(
      'TRUNCATE',
      'The audit ledger cannot be truncated or cleared.'
    );
  }

  /**
   * Returns the SQL trigger script for database migrations.
   */
  public getSqliteSchemaAndTriggers(): string {
    return ImmutableLedgerRepository.SQL_TRIGGERS_SCHEMA;
  }

  /**
   * Enforces role isolation for write operations.
   * Auditor and Owner are explicitly prohibited from write mutations.
   */
  private assertWritePrivileges(principal: LedgerPrincipal): void {
    const role = principal.role as LedgerRole;

    if (role === 'Auditor' || role === 'OWNER') {
      throw new LedgerRoleAccessDeniedError(
        role,
        'ledger:append',
        `Role '${role}' possesses strictly read-only and export capabilities with zero write or mutation privileges.`
      );
    }

    if (role !== 'System' && role !== 'Admin') {
      throw new LedgerRoleAccessDeniedError(
        role,
        'ledger:append',
        `Role '${role}' is not authorized to append entries to the immutable audit ledger.`
      );
    }
  }

  /**
   * Enforces role isolation for read operations.
   * Auditor and Owner are permitted. Waiter and Kitchen are denied.
   */
  private assertReadPrivileges(principal: LedgerPrincipal): void {
    const role = principal.role as LedgerRole;

    if (role === 'WAITER' || role === 'KITCHEN') {
      throw new LedgerRoleAccessDeniedError(
        role,
        'ledger:select',
        `Strict isolation mandate forbids '${role}' from accessing audit ledger records.`
      );
    }

    const permittedRoles: LedgerRole[] = ['Auditor', 'OWNER', 'System', 'Admin', 'MANAGER'];
    if (!permittedRoles.includes(role)) {
      throw new LedgerRoleAccessDeniedError(role, 'ledger:select');
    }
  }



  /**
   * Enforces role isolation for export operations.
   * Auditor and Owner possess explicit export capabilities.
   */
  private assertExportPrivileges(principal: LedgerPrincipal): void {
    const role = principal.role as LedgerRole;

    if (role === 'WAITER' || role === 'KITCHEN' || role === 'MANAGER') {
      throw new LedgerRoleAccessDeniedError(
        role,
        'ledger:export',
        `Role '${role}' is not permitted to export cryptographic ledger records.`
      );
    }

    const permittedRoles: LedgerRole[] = ['Auditor', 'OWNER', 'System', 'Admin'];
    if (!permittedRoles.includes(role)) {
      throw new LedgerRoleAccessDeniedError(role, 'ledger:export');
    }
  }

  /**
   * Formats entries as RFC 4180 compliant CSV.
   */
  private formatAsCsv(entries: readonly AuditEntry[]): string {
    const headers = [
      'sequence',
      'id',
      'timestamp',
      'actor_id',
      'actor_role',
      'action',
      'resource_id',
      'previous_hash',
      'current_hash',
      'payload',
      'metadata',
    ];

    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;

    const lines = [headers.join(',')];
    for (const entry of entries) {
      const row = [
        entry.sequence.toString(),
        escapeCsv(entry.id),
        escapeCsv(entry.timestamp),
        escapeCsv(entry.actor_id),
        escapeCsv(entry.actor_role),
        escapeCsv(entry.action),
        escapeCsv(entry.resource_id),
        escapeCsv(entry.previous_hash),
        escapeCsv(entry.current_hash),
        escapeCsv(canonicalJsonStringify(entry.payload)),
        escapeCsv(entry.metadata ? canonicalJsonStringify(entry.metadata) : ''),
      ];
      lines.push(row.join(','));
    }

    return lines.join('\r\n');
  }
}
