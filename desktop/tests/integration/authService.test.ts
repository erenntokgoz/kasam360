
import { AuthService, AuthRateLimitError, InvalidCredentialsError } from '../../src/domain/usecases/auth/AuthService';
import { AuthorizationGuard, SecurityAccessDeniedError } from '../../src/domain/usecases/auth/AuthorizationGuard';
import { BranchIsolationGuard, IsolationViolationException } from '../../src/domain/usecases/branch/BranchIsolationGuard';
import { SecurityPrincipal } from '../../src/core/security/roles.types';

describe('Auth & Permission Tests', () => {
  let authService: AuthService;
  let guard: AuthorizationGuard;

  beforeEach(() => {
    (AuthService as any).instance = undefined; // Reset singleton
    authService = AuthService.getInstance();
    guard = authService.getGuard();
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

  // Faz 3 (K4/C-3): onay kuyruğu kaldırıldı. Aynı iş kuralı — büyük tutarlı
  // iade için üst yönetim onayı zorunlu — artık anlık PIN onayıyla karşılanır.
  // Kuyruk motorunun testleri yerine onay yüzeyinin kuralları
  // `instantPinApproval.test.ts` içinde sınanır; burada rol kapıları korunur.
  it('required manager approval gate -> DENIED without approval', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    const cashier: SecurityPrincipal = { userId: 'c1', role: 'CASHIER' };

    // Kasa, eşiği aşan bir indirim için tek başına onay üretemez.
    const code = await tauriInvoke('verify_manager_pin', {
      payload: {
        operation: 'DISCOUNT',
        resourceId: 'ord_1',
        actorId: cashier.userId,
        actorRole: cashier.role,
        amountCents: 999999,
        discountPercent: 60,
        pin: '4444',
        terminalId: 'POS_MAIN_01',
      },
      tenantId: 'DEFAULT_TENANT',
    }).then(
      () => null,
      (err: unknown) => String(err),
    );
    expect(code).toContain('INVALID_APPROVAL_PIN');
  });

  it('valid manager approval -> PASS', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    const manager: SecurityPrincipal = { userId: 'm1', role: 'MANAGER' };

    const approval = await tauriInvoke<{ approved: boolean; approverRole: string }>(
      'verify_manager_pin',
      {
        payload: {
          operation: 'DISCOUNT',
          resourceId: 'ord_1',
          actorId: 'c1',
          actorRole: 'CASHIER',
          amountCents: 999999,
          discountPercent: 60,
          pin: '3333',
          terminalId: 'POS_MAIN_01',
        },
        tenantId: 'DEFAULT_TENANT',
      },
    );

    expect(approval.approved).toBe(true);
    expect(approval.approverRole).toBe(manager.role);
  });
});
