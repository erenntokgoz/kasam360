
import { AuthService, AuthRateLimitError, InvalidCredentialsError } from '../../src/domain/usecases/auth/AuthService';
import { AuthorizationGuard, SecurityAccessDeniedError } from '../../src/domain/usecases/auth/AuthorizationGuard';
import { ApprovalWorkflowEngine } from '../../src/domain/usecases/auth/ApprovalWorkflowEngine';
import { BranchIsolationGuard, IsolationViolationException } from '../../src/domain/usecases/branch/BranchIsolationGuard';
import { SecurityPrincipal } from '../../src/core/security/roles.types';

describe('Auth & Permission Tests', () => {
  let authService: AuthService;
  let guard: AuthorizationGuard;
  let approvalEngine: ApprovalWorkflowEngine;

  beforeEach(() => {
    (AuthService as any).instance = undefined; // Reset singleton
    authService = AuthService.getInstance();
    guard = authService.getGuard();
    approvalEngine = new ApprovalWorkflowEngine(guard);
    BranchIsolationGuard.clearActiveContext();
    vi.useRealTimers();
  });

  it('cashier allowed operation -> PASS', () => {
    expect(() => guard.assertPermission('CASHIER', 'order:create')).not.toThrow();
    expect(guard.can('CASHIER', 'transaction:refund')).toBe(true);
  });

  it('cashier unauthorized operation -> DENIED', () => {
    expect(() => guard.assertPermission('CASHIER', 'financial:report:view')).toThrow(SecurityAccessDeniedError);
  });

  it('waiter unauthorized operation -> DENIED', () => {
    expect(() => guard.assertPermission('WAITER', 'transaction:refund')).toThrow();
  });

  it('cook unauthorized operation -> DENIED', () => {
    expect(() => guard.assertPermission('KITCHEN', 'order:create')).toThrow();
  });

  it('manager allowed operation -> PASS', () => {
    expect(() => guard.assertPermission('MANAGER', 'transaction:refund')).not.toThrow();
  });

  it('patron allowed operation -> PASS', () => {
    expect(() => guard.assertPermission('OWNER', 'financial:cost_settings:modify')).not.toThrow();
  });

  it('expired session -> DENIED', () => {
    vi.useFakeTimers();
    authService.loginWithPin('1111');
    vi.advanceTimersByTime(9 * 60 * 60 * 1000); // 9 hours later
    expect(authService.getCurrentSession()).toBeNull();
    expect(() => authService.requireAuth()).toThrow('Authentication required. Session is invalid or expired.');
  });

  it('invalid session -> DENIED', () => {
    expect(() => authService.requireAuth()).toThrow('Authentication required. Session is invalid or expired.');
  });

  it('wrong PIN -> EXPECTED FAILURE', () => {
    expect(() => authService.loginWithPin('9999')).toThrow(InvalidCredentialsError);
  });

  it('PIN rate limit locks out after 3 failures', () => {
    vi.useFakeTimers();
    expect(() => authService.loginWithPin('9999')).toThrow(InvalidCredentialsError);
    expect(() => authService.loginWithPin('9999')).toThrow(InvalidCredentialsError);
    expect(() => authService.loginWithPin('9999')).toThrow(AuthRateLimitError);
    
    // Still locked immediately after
    expect(() => authService.loginWithPin('1111')).toThrow(AuthRateLimitError);

    // Unlocks after 1 minute
    vi.advanceTimersByTime(60 * 1001);
    expect(() => authService.loginWithPin('1111')).not.toThrow();
  });

  it('tenant mismatch -> DENIED', () => {
    BranchIsolationGuard.setActiveContext({ tenantId: 'tenant1', branchId: 'b1', userId: 'u1', roles: [] });
    expect(() => BranchIsolationGuard.assertTenantAccess('tenant2')).toThrow(IsolationViolationException);
  });

  it('branch mismatch -> DENIED', () => {
    BranchIsolationGuard.setActiveContext({ tenantId: 'tenant1', branchId: 'b1', userId: 'u1', roles: [] });
    expect(() => BranchIsolationGuard.assertBranchAccess('b2')).toThrow(IsolationViolationException);
  });

  it('missing permission -> DENIED', () => {
    expect(() => guard.assertPermission('WAITER', 'financial:cost_settings:view')).toThrow();
  });

  it('required manager approval missing -> DENIED', () => {
    const waiter: SecurityPrincipal = { userId: 'u1', role: 'WAITER' };
    const resultWaiter = approvalEngine.evaluateAndProcess({
      operationType: 'refund',
      amount: 100,
      actor: waiter,
      targetResourceId: 'ord_1',
      reason: 'wrong item'
    });
    expect(resultWaiter.status).toBe('HALTED_REQUIRES_APPROVAL');
    
    // Wait, let's test a cashier exceeding threshold
    const cashier: SecurityPrincipal = { userId: 'c1', role: 'CASHIER' };
    const result = approvalEngine.evaluateAndProcess({
      operationType: 'refund',
      amount: 999999, // Exceeds 4500
      actor: cashier,
      targetResourceId: 'ord_1',
      reason: 'big refund'
    });
    
    expect(result.status).toBe('HALTED_REQUIRES_APPROVAL');
  });

  it('valid manager approval -> PASS', () => {
    const cashier: SecurityPrincipal = { userId: 'c1', role: 'CASHIER' };
    const manager: SecurityPrincipal = { userId: 'm1', role: 'MANAGER' };
    
    const evalResult = approvalEngine.evaluateAndProcess({
      operationType: 'refund',
      amount: 999999,
      actor: cashier,
      targetResourceId: 'ord_1',
      reason: 'big refund'
    });
    
    if (evalResult.status !== 'HALTED_REQUIRES_APPROVAL') {
      throw new Error('Expected HALTED_REQUIRES_APPROVAL');
    }

    const resolution = approvalEngine.resolveApprovalRequest({
      requestId: evalResult.approvalRequest.id,
      reviewer: manager,
      decision: 'APPROVE'
    });

    expect(resolution.request.status).toBe('APPROVED');
  });
});
