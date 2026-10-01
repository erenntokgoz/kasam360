import {
  ApprovalRequest,
  ApprovalStatus,
  AuditLogEntry,
  CriticalOperationType,
  FINANCIAL_APPROVAL_THRESHOLD,
  Permission,
  SecurityPrincipal,
} from '../../../core/security/roles.types';
import { AuthorizationGuard, SecurityAccessDeniedError } from './AuthorizationGuard';
import { calculateSha256, canonicalJsonStringify } from '../../../core/security/digest';

export { calculateSha256 };

export interface CriticalTransactionParams {
  readonly operationType: CriticalOperationType;
  readonly amount: number;
  readonly actor: SecurityPrincipal;
  readonly targetResourceId: string;
  readonly reason: string;
  readonly metadata?: Record<string, unknown>;
}

export type ExecutionDisposition =
  | {
      readonly status: 'EXECUTED_DIRECTLY';
      readonly message: string;
      readonly auditEntry: AuditLogEntry;
    }
  | {
      readonly status: 'HALTED_REQUIRES_APPROVAL';
      readonly message: string;
      readonly approvalRequest: ApprovalRequest;
      readonly auditEntry: AuditLogEntry;
    };

export interface ResolveApprovalParams {
  readonly requestId: string;
  readonly reviewer: SecurityPrincipal;
  readonly decision: 'APPROVE' | 'REJECT';
  readonly note?: string;
}

export interface ResolveApprovalResult {
  readonly request: ApprovalRequest;
  readonly auditEntry: AuditLogEntry;
}

/**
 * Eşiği aşan yüksek riskli işlemleri yakalayan,
 * yönetici geçersiz kılma kuyruğunu yöneten ve kriptografik denetim izlerini kaydeden motor.
 */
export class ApprovalWorkflowEngine {
  public static readonly GENESIS_HASH =
    '0000000000000000000000000000000000000000000000000000000000000000';

  private readonly guard: AuthorizationGuard;
  private readonly threshold: number;
  private readonly queue: Map<string, ApprovalRequest> = new Map();
  private readonly auditLedger: AuditLogEntry[] = [];
  private sequenceCounter = 0;

  constructor(
    guard: AuthorizationGuard = new AuthorizationGuard(),
    threshold: number = FINANCIAL_APPROVAL_THRESHOLD
  ) {
    this.guard = guard;
    this.threshold = threshold;
  }

  public getThreshold(): number {
    return this.threshold;
  }

  /**
   * Gelen kritik bir işlemi değerlendirir.
   * İşlem finansal eşiği aşıyorsa veya yetkisiz roller için onay gerektiriyorsa,
   * doğrudan yürütme durdurulur ve değişmez bir denetim kaydıyla Yönetici/Sahip kuyruğuna yönlendirilir.
   */
  public evaluateAndProcess(params: CriticalTransactionParams): ExecutionDisposition {
    if (params.amount < 0 || !Number.isFinite(params.amount)) {
      throw new Error(`Invalid transaction amount: ${params.amount}. Amount must be non-negative.`);
    }

    if (params.actor.role === 'KITCHEN') {
      throw new SecurityAccessDeniedError(
        'KITCHEN',
        this.mapOperationToPermission(params.operationType),
        'CriticalTransactionInitiation'
      );
    }

    const permission = this.mapOperationToPermission(params.operationType);
    const hasBasePermission = this.guard.can(params.actor.role, permission);
    const exceedsThreshold = params.amount > this.threshold;

    // Doğrudan yürütmeye yalnızca rol temel izne sahipse VE eşiği aşmıyorsa,
    // veya rol Sahip (mutlak idari yetki) ise izin verilir.
    const canExecuteDirectly =
      params.actor.role === 'OWNER' || (hasBasePermission && !exceedsThreshold);

    if (canExecuteDirectly) {
      const auditEntry = this.commitAuditLog({
        requestId: `direct-${Date.now()}-${++this.sequenceCounter}`,
        action: 'TRANSACTION_EXECUTED_DIRECTLY',
        actor: params.actor,
        operationType: params.operationType,
        amount: params.amount,
        status: 'APPROVED',
        details: {
          reason: params.reason,
          targetResourceId: params.targetResourceId,
          threshold: this.threshold,
          metadata: params.metadata ?? {},
        },
      });

      return {
        status: 'EXECUTED_DIRECTLY',
        message: `Transaction of ${params.amount} TL executed directly under role '${params.actor.role}'.`,
        auditEntry,
      };
    }

    // Durdurma Mekanizması: doğrudan yürütme engellendi. ApprovalRequest oluştur ve Yönetici/Sahip kuyruğuna yönlendir.
    const requestId = `appr-${Date.now()}-${++this.sequenceCounter}`;
    const approvalRequest: ApprovalRequest = {
      id: requestId,
      operationType: params.operationType,
      amount: params.amount,
      currency: 'TL',
      requester: params.actor,
      targetResourceId: params.targetResourceId,
      reason: params.reason,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      metadata: params.metadata,
    };

    this.queue.set(requestId, approvalRequest);

    const auditEntry = this.commitAuditLog({
      requestId,
      action: exceedsThreshold
        ? 'TRANSACTION_HALTED_THRESHOLD_BREACHED'
        : 'TRANSACTION_HALTED_APPROVAL_REQUIRED',
      actor: params.actor,
      operationType: params.operationType,
      amount: params.amount,
      status: 'PENDING',
      details: {
        reason: params.reason,
        targetResourceId: params.targetResourceId,
        threshold: this.threshold,
        exceedsThreshold,
        metadata: params.metadata ?? {},
      },
    });

    return {
      status: 'HALTED_REQUIRES_APPROVAL',
      message: exceedsThreshold
        ? `Transaction of ${params.amount} TL breaches strict ${this.threshold} TL threshold. Direct execution halted; approval request queued.`
        : `Role '${params.actor.role}' lacks direct execution authority. Direct execution halted; approval request queued.`,
      approvalRequest,
      auditEntry,
    };
  }

  /**
   * Tüm bekleyen onay isteklerini getirir.
   * Erişim kesinlikle Yönetici ve Sahip rolleriyle sınırlıdır.
   */
  public getPendingQueue(viewer: SecurityPrincipal): readonly ApprovalRequest[] {
    this.guard.assertPermission(viewer.role, 'approval:queue:view', 'ViewApprovalQueue');

    const pending: ApprovalRequest[] = [];
    for (const req of this.queue.values()) {
      if (req.status === 'PENDING') {
        pending.push(req);
      }
    }
    return pending;
  }

  /**
   * Kimliğe göre belirli bir onay isteğini getirir.
   */
  public getRequestById(requestId: string, viewer: SecurityPrincipal): ApprovalRequest | undefined {
    this.guard.assertPermission(viewer.role, 'approval:queue:view', 'GetApprovalRequestById');
    return this.queue.get(requestId);
  }

  /**
   * Yönetici/Sahip geçersiz kılma yetkisiyle bekleyen bir onay isteğini çözer.
   */
  public resolveApprovalRequest(params: ResolveApprovalParams): ResolveApprovalResult {
    this.guard.assertPermission(
      params.reviewer.role,
      'approval:override:execute',
      'ResolveApprovalRequest'
    );

    const existing = this.queue.get(params.requestId);
    if (!existing) {
      throw new Error(`Approval request with ID '${params.requestId}' not found.`);
    }

    if (existing.status !== 'PENDING') {
      throw new Error(
        `Approval request '${params.requestId}' has already been resolved with status '${existing.status}'.`
      );
    }

    const resolvedStatus: ApprovalStatus = params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    const resolvedRequest: ApprovalRequest = {
      ...existing,
      status: resolvedStatus,
      resolvedAt: new Date().toISOString(),
      resolvedBy: params.reviewer,
      resolutionNote: params.note,
    };

    this.queue.set(params.requestId, resolvedRequest);

    const auditEntry = this.commitAuditLog({
      requestId: existing.id,
      action:
        resolvedStatus === 'APPROVED' ? 'APPROVAL_OVERRIDE_GRANTED' : 'APPROVAL_OVERRIDE_REJECTED',
      actor: params.reviewer,
      operationType: existing.operationType,
      amount: existing.amount,
      status: resolvedStatus,
      details: {
        note: params.note ?? '',
        originalRequester: existing.requester,
        targetResourceId: existing.targetResourceId,
      },
    });

    return {
      request: resolvedRequest,
      auditEntry,
    };
  }

  /**
   * Değişmez denetim defterini döndürür.
   */
  public getAuditLedger(): readonly AuditLogEntry[] {
    return [...this.auditLedger];
  }

  /**
   * Başlangıçtan itibaren denetim defterinin bütünlüğünü kriptografik olarak doğrular.
   * Hiçbir giriş yükünün değiştirilmediğinden ve tüm karma zincirlerinin kırılmamış kaldığından emin olur.
   */
  public verifyLedgerIntegrity(): boolean {
    let previousHash = ApprovalWorkflowEngine.GENESIS_HASH;

    for (const entry of this.auditLedger) {
      if (entry.previousHash !== previousHash) {
        return false;
      }

      const calculated = this.computeHash({
        auditId: entry.auditId,
        requestId: entry.requestId,
        timestamp: entry.timestamp,
        action: entry.action,
        actor: entry.actor,
        operationType: entry.operationType,
        amount: entry.amount,
        status: entry.status,
        previousHash: entry.previousHash,
        details: entry.details,
      });

      if (entry.payloadHash !== calculated) {
        return false;
      }

      previousHash = entry.payloadHash;
    }

    return true;
  }

  private mapOperationToPermission(operationType: CriticalOperationType): Permission {
    switch (operationType) {
      case 'refund':
        return 'transaction:refund';
      case 'discount':
        return 'transaction:discount';
      case 'cancellation':
        return 'transaction:cancel';
    }
  }

  private commitAuditLog(data: {
    requestId: string;
    action: string;
    actor: SecurityPrincipal;
    operationType: CriticalOperationType;
    amount: number;
    status: ApprovalStatus;
    details: Record<string, unknown>;
  }): AuditLogEntry {
    const previousHash =
      this.auditLedger.length > 0
        ? this.auditLedger[this.auditLedger.length - 1].payloadHash
        : ApprovalWorkflowEngine.GENESIS_HASH;

    const auditId = `aud-${Date.now()}-${++this.sequenceCounter}`;
    const timestamp = new Date().toISOString();

    const payloadHash = this.computeHash({
      auditId,
      requestId: data.requestId,
      timestamp,
      action: data.action,
      actor: data.actor,
      operationType: data.operationType,
      amount: data.amount,
      status: data.status,
      previousHash,
      details: data.details,
    });

    const entry: AuditLogEntry = {
      auditId,
      requestId: data.requestId,
      timestamp,
      action: data.action,
      actor: data.actor,
      operationType: data.operationType,
      amount: data.amount,
      status: data.status,
      payloadHash,
      previousHash,
      details: data.details,
    };

    this.auditLedger.push(entry);
    return entry;
  }

  private computeHash(fields: {
    auditId: string;
    requestId: string;
    timestamp: string;
    action: string;
    actor: SecurityPrincipal;
    operationType: CriticalOperationType;
    amount: number;
    status: ApprovalStatus;
    previousHash: string;
    details: Record<string, unknown>;
  }): string {
    const serialized = canonicalJsonStringify({
      auditId: fields.auditId,
      requestId: fields.requestId,
      timestamp: fields.timestamp,
      action: fields.action,
      actor: fields.actor,
      operationType: fields.operationType,
      amount: fields.amount,
      status: fields.status,
      previousHash: fields.previousHash,
      details: fields.details,
    });
    return calculateSha256(serialized);
  }
}
