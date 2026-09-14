/**
 * Core Security & RBAC Types for Kasam360
 * Enterprise Security & RBAC Scaffolding
 */

export type Role = 'MASTER' | 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export const ROLES: readonly Role[] = ['MASTER', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const;

export type ScreenPermission =
  | 'screen:financial_reports'
  | 'screen:cost_settings'
  | 'screen:admin_dashboard'
  | 'screen:pos'
  | 'screen:kds'
  | 'screen:inventory'
  | 'screen:approval_queue';

export type ActionPermission =
  | 'financial:report:view'
  | 'financial:cost_settings:view'
  | 'financial:cost_settings:modify'
  | 'admin:dashboard:view'
  | 'admin:system_settings:modify'
  | 'admin:user_roles:manage'
  | 'order:create'
  | 'order:view'
  | 'order:modify'
  | 'order:cancel'
  | 'kds:view'
  | 'kds:status:update'
  | 'inventory:view'
  | 'inventory:manage'
  | 'transaction:refund'
  | 'transaction:discount'
  | 'transaction:cancel'
  | 'approval:queue:view'
  | 'approval:override:execute';

export type Permission = ScreenPermission | ActionPermission;

/**
 * Access matrix mapping each system role to its permitted operations and screens
 */
export type AccessMatrix = Record<Role, readonly Permission[]>;

/**
 * Strict Data Boundary Segregation:
 * Forbidden permissions for Waiter and Kitchen roles.
 * Waiter and Kitchen roles are strictly prohibited from accessing financial reporting,
 * cost settings, or Owner-level administrative dashboards.
 */
export const RESTRICTED_FINANCIAL_PERMISSIONS: readonly Permission[] = [
  'screen:financial_reports',
  'screen:cost_settings',
  'financial:report:view',
  'financial:cost_settings:view',
  'financial:cost_settings:modify',
] as const;

export const RESTRICTED_ADMIN_PERMISSIONS: readonly Permission[] = [
  'screen:admin_dashboard',
  'admin:dashboard:view',
  'admin:system_settings:modify',
  'admin:user_roles:manage',
] as const;

export const FORBIDDEN_WAITER_PERMISSIONS: readonly Permission[] = [
  ...RESTRICTED_FINANCIAL_PERMISSIONS,
  ...RESTRICTED_ADMIN_PERMISSIONS,
  'approval:override:execute',
  'screen:approval_queue',
  'approval:queue:view',
  'inventory:manage',
] as const;

export const FORBIDDEN_KITCHEN_PERMISSIONS: readonly Permission[] = [
  ...RESTRICTED_FINANCIAL_PERMISSIONS,
  ...RESTRICTED_ADMIN_PERMISSIONS,
  'screen:pos',
  'order:create',
  'order:modify',
  'order:cancel',
  'transaction:refund',
  'transaction:discount',
  'transaction:cancel',
  'approval:override:execute',
  'screen:approval_queue',
  'approval:queue:view',
  'inventory:manage',
] as const;

/**
 * Default rigid Role-Based Access Control Matrix
 */
export const DEFAULT_ACCESS_MATRIX: AccessMatrix = {
  MASTER: [
    'screen:financial_reports',
    'screen:cost_settings',
    'screen:admin_dashboard',
    'screen:pos',
    'screen:kds',
    'screen:inventory',
    'screen:approval_queue',
    'financial:report:view',
    'financial:cost_settings:view',
    'financial:cost_settings:modify',
    'admin:dashboard:view',
    'admin:system_settings:modify',
    'admin:user_roles:manage',
    'order:create',
    'order:view',
    'order:modify',
    'order:cancel',
    'kds:view',
    'kds:status:update',
    'inventory:view',
    'inventory:manage',
    'transaction:refund',
    'transaction:discount',
    'transaction:cancel',
    'approval:queue:view',
    'approval:override:execute',
  ],
  OWNER: [
    'screen:financial_reports',
    'screen:cost_settings',
    'screen:admin_dashboard',
    'screen:pos',
    'screen:kds',
    'screen:inventory',
    'screen:approval_queue',
    'financial:report:view',
    'financial:cost_settings:view',
    'financial:cost_settings:modify',
    'admin:dashboard:view',
    'admin:system_settings:modify',
    'admin:user_roles:manage',
    'order:create',
    'order:view',
    'order:modify',
    'order:cancel',
    'kds:view',
    'kds:status:update',
    'inventory:view',
    'inventory:manage',
    'transaction:refund',
    'transaction:discount',
    'transaction:cancel',
    'approval:queue:view',
    'approval:override:execute',
  ],
  MANAGER: [
    'screen:financial_reports',
    'screen:cost_settings',
    'screen:pos',
    'screen:kds',
    'screen:inventory',
    'screen:approval_queue',
    'financial:report:view',
    'financial:cost_settings:view',
    'order:create',
    'order:view',
    'order:modify',
    'order:cancel',
    'kds:view',
    'kds:status:update',
    'inventory:view',
    'inventory:manage',
    'transaction:refund',
    'transaction:discount',
    'transaction:cancel',
    'approval:queue:view',
    'approval:override:execute',
  ],
  CASHIER: [
    'screen:pos',
    'order:create',
    'order:view',
    'order:modify',
    'order:cancel',
    'transaction:refund',
    'transaction:discount',
    'transaction:cancel',
  ],
  WAITER: ['screen:pos', 'order:create', 'order:view', 'order:modify'],
  KITCHEN: ['screen:kds', 'kds:view', 'kds:status:update', 'inventory:view'],
};

/**
 * Financial threshold parameter for critical transactions (4500 TL)
 */
export const FINANCIAL_APPROVAL_THRESHOLD = 4500;

export type CriticalOperationType = 'refund' | 'cancellation' | 'discount';

export const CRITICAL_OPERATIONS: readonly CriticalOperationType[] = [
  'refund',
  'cancellation',
  'discount',
] as const;

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SecurityPrincipal {
  readonly userId: string;
  readonly role: Role;
  readonly name?: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly operationType: CriticalOperationType;
  readonly amount: number;
  readonly currency: 'TL';
  readonly requester: SecurityPrincipal;
  readonly targetResourceId: string;
  readonly reason: string;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: SecurityPrincipal;
  readonly resolutionNote?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  readonly auditId: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly action: string;
  readonly actor: SecurityPrincipal;
  readonly operationType: CriticalOperationType;
  readonly amount: number;
  readonly status: ApprovalStatus;
  readonly payloadHash: string;
  readonly previousHash: string;
  readonly details: Record<string, unknown>;
}
