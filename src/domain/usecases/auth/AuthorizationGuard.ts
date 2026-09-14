import {
  AccessMatrix,
  DEFAULT_ACCESS_MATRIX,
  FORBIDDEN_KITCHEN_PERMISSIONS,
  FORBIDDEN_WAITER_PERMISSIONS,
  Permission,
  Role,
  ScreenPermission,
} from '../../../core/security/roles.types';

export class SecurityAccessDeniedError extends Error {
  public readonly name = 'SecurityAccessDeniedError';

  constructor(
    public readonly role: Role,
    public readonly permission: Permission,
    public readonly context?: string
  ) {
    super(
      `Access Denied: Role '${role}' lacks permission '${permission}'${
        context ? ` for context '${context}'` : ''
      }.`
    );
    Object.setPrototypeOf(this, SecurityAccessDeniedError.prototype);
  }
}

export class DataBoundaryViolationError extends Error {
  public readonly name = 'DataBoundaryViolationError';

  constructor(
    public readonly role: Role,
    public readonly forbiddenPermission: Permission,
    public readonly context?: string
  ) {
    super(
      `Strict Isolation Mandate Violation: Role '${role}' is strictly prohibited from accessing '${forbiddenPermission}'${
        context ? ` in context '${context}'` : ''
      }.`
    );
    Object.setPrototypeOf(this, DataBoundaryViolationError.prototype);
  }
}

/**
 * Rigid authorization guard enforcing RBAC and absolute data boundary segregation.
 * Prevents unauthorized access to screens, domain operations, and high-privilege subsystems.
 */
export class AuthorizationGuard {
  private readonly matrix: AccessMatrix;

  constructor(matrix: AccessMatrix = DEFAULT_ACCESS_MATRIX) {
    AuthorizationGuard.validateMatrixIntegrity(matrix);
    this.matrix = matrix;
  }

  /**
   * Verifies that the access matrix strictly adheres to boundary segregation rules.
   * Throws DataBoundaryViolationError if any forbidden permission is granted to restricted roles.
   */
  public static validateMatrixIntegrity(matrix: AccessMatrix): void {
    const waiterPermissions = matrix.WAITER || [];
    for (const perm of FORBIDDEN_WAITER_PERMISSIONS) {
      if (waiterPermissions.includes(perm)) {
        throw new DataBoundaryViolationError(
          'WAITER',
          perm,
          'Access Matrix Integrity Verification'
        );
      }
    }

    const kitchenPermissions = matrix.KITCHEN || [];
    for (const perm of FORBIDDEN_KITCHEN_PERMISSIONS) {
      if (kitchenPermissions.includes(perm)) {
        throw new DataBoundaryViolationError(
          'KITCHEN',
          perm,
          'Access Matrix Integrity Verification'
        );
      }
    }
  }

  /**
   * Checks whether a specific role is strictly forbidden from an operation
   * under the enterprise isolation mandate.
   */
  public static isStrictlyForbidden(role: Role, permission: Permission): boolean {
    if (role === 'WAITER') {
      return FORBIDDEN_WAITER_PERMISSIONS.includes(permission);
    }
    if (role === 'KITCHEN') {
      return FORBIDDEN_KITCHEN_PERMISSIONS.includes(permission);
    }
    return false;
  }

  /**
   * Evaluates if a role has the specified permission.
   * Returns false immediately if the permission violates isolation boundaries.
   */
  public can(role: Role, permission: Permission): boolean {
    if (AuthorizationGuard.isStrictlyForbidden(role, permission)) {
      return false;
    }

    const rolePermissions = this.matrix[role];
    if (!rolePermissions) {
      return false;
    }

    return rolePermissions.includes(permission);
  }

  /**
   * Verifies screen access for a given role.
   */
  public canAccessScreen(role: Role, screen: ScreenPermission): boolean {
    return this.can(role, screen);
  }

  /**
   * Asserts that a role has the required permission.
   * Throws DataBoundaryViolationError if strictly forbidden, or SecurityAccessDeniedError if not granted.
   */
  public assertPermission(role: Role, permission: Permission, context?: string): void {
    if (AuthorizationGuard.isStrictlyForbidden(role, permission)) {
      throw new DataBoundaryViolationError(role, permission, context);
    }

    if (!this.can(role, permission)) {
      throw new SecurityAccessDeniedError(role, permission, context);
    }
  }

  /**
   * Asserts that a role has access to a specific screen view.
   */
  public assertScreenAccess(role: Role, screen: ScreenPermission, context?: string): void {
    this.assertPermission(role, screen, context);
  }

  /**
   * Returns all active, non-forbidden permissions for a given role.
   */
  public getPermissions(role: Role): readonly Permission[] {
    const raw = this.matrix[role] ?? [];
    return raw.filter((perm) => !AuthorizationGuard.isStrictlyForbidden(role, perm));
  }

  /**
   * Checks if a role is permitted to view financial reports.
   */
  public isFinancialReportingPermitted(role: Role): boolean {
    return this.can(role, 'financial:report:view') && this.can(role, 'screen:financial_reports');
  }

  /**
   * Checks if a role is permitted to access cost settings.
   */
  public isCostSettingsPermitted(role: Role): boolean {
    return this.can(role, 'financial:cost_settings:view') && this.can(role, 'screen:cost_settings');
  }

  /**
   * Checks if a role is permitted to access the Owner-level administrative dashboard.
   */
  public isAdminDashboardPermitted(role: Role): boolean {
    return this.can(role, 'admin:dashboard:view') && this.can(role, 'screen:admin_dashboard');
  }
}
