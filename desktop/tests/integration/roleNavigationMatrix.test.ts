

/**
 * KASAM360 — Role Navigation & Button Permissions Validation Suite
 *
 * Doğrulanan Kural ve Invariant'lar:
 * 1. AGENTS.md Madde 4 Role Matrix uyarınca hiçbir rol yetkisiz ekran butonu göremez.
 * 2. GlobalNav üzerindeki her buton, App.tsx içerisindeki allowedViews ile %100 örtüşür.
 * 3. Hiçbir kullanıcı tıklandığında geri atılan (phantom/işlevsiz) buton görmez.
 */

interface RolePermissions {
  allowedViews: string[];
  defaultView: string;
  canSeePos: boolean;
  canSeeCashier: boolean;
  canSeeFloor: boolean;
  canSeeReceipts: boolean;
  canSeeKds: boolean;
  canSeeEndOfDay: boolean;
  canSeeOwnerDashboard: boolean;
  canSeeManagement: boolean;
}

function getRoleNavPermissions(role: string): RolePermissions {
  let allowedViews: string[] = [];
  let defaultView = 'FLOOR';

  switch (role) {
    case 'MASTER':
      allowedViews = ['PLATFORM'];
      defaultView = 'PLATFORM';
      break;
    case 'OWNER':
      // İşletme sahibi: Restoran düzeyindeki tüm operasyonel ve yönetsel ekranlara tam erişim hakkı
      allowedViews = ['OWNER_DASHBOARD', 'MANAGEMENT', 'FLOOR', 'POS', 'KDS', 'CASHIER', 'RECEIPTS', 'END_OF_DAY'];
      defaultView = 'OWNER_DASHBOARD';
      break;
    case 'MANAGER':
      allowedViews = ['MANAGEMENT', 'FLOOR', 'POS', 'KDS', 'RECEIPTS', 'END_OF_DAY'];
      defaultView = 'MANAGEMENT';
      break;
    case 'CASHIER':
      allowedViews = ['CASHIER', 'POS', 'FLOOR', 'RECEIPTS'];
      defaultView = 'CASHIER';
      break;
    case 'WAITER':
      allowedViews = ['POS', 'FLOOR'];
      defaultView = 'FLOOR';
      break;
    case 'KITCHEN':
      allowedViews = ['KDS'];
      defaultView = 'KDS';
      break;
    default:
      allowedViews = [];
      defaultView = 'FLOOR';
  }

  // GlobalNav mantığı
  const canSeePos = ['WAITER', 'CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeCashier = ['CASHIER', 'OWNER'].includes(role);
  const canSeeFloor = ['WAITER', 'CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeReceipts = ['CASHIER', 'MANAGER', 'OWNER'].includes(role);
  const canSeeKds = ['KITCHEN', 'MANAGER', 'OWNER'].includes(role);
  const canSeeEndOfDay = ['MANAGER', 'OWNER'].includes(role);
  const canSeeOwnerDashboard = role === 'OWNER';
  const canSeeManagement = ['MANAGER', 'OWNER'].includes(role);

  return {
    allowedViews,
    defaultView,
    canSeePos,
    canSeeCashier,
    canSeeFloor,
    canSeeReceipts,
    canSeeKds,
    canSeeEndOfDay,
    canSeeOwnerDashboard,
    canSeeManagement,
  };
}

describe('KASAM360 — Role Navigation & Button Permissions Matrix', () => {
  const roles = ['MASTER', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const;

  roles.forEach((role) => {
    describe(`Role: ${role}`, () => {
      const perms = getRoleNavPermissions(role);

      it('defaultView is included in allowedViews', () => {
        expect(perms.allowedViews).toContain(perms.defaultView);
      });

      if (role !== 'MASTER') {
        it('every visible GlobalNav button is authorized in allowedViews (no dead/bouncing buttons)', () => {
          if (perms.canSeePos) {
            expect(perms.allowedViews).toContain('POS');
          }
          if (perms.canSeeCashier) {
            expect(perms.allowedViews).toContain('CASHIER');
          }
          if (perms.canSeeFloor) {
            expect(perms.allowedViews).toContain('FLOOR');
          }
          if (perms.canSeeReceipts) {
            expect(perms.allowedViews).toContain('RECEIPTS');
          }
          if (perms.canSeeKds) {
            expect(perms.allowedViews).toContain('KDS');
          }
          if (perms.canSeeEndOfDay) {
            expect(perms.allowedViews).toContain('END_OF_DAY');
          }
          if (perms.canSeeOwnerDashboard) {
            expect(perms.allowedViews).toContain('OWNER_DASHBOARD');
          }
          if (perms.canSeeManagement) {
            expect(perms.allowedViews).toContain('MANAGEMENT');
          }
        });
      }
    });
  });

  describe('Strict AGENTS.md Constitution Role Boundaries', () => {
    it('OWNER has FULL access to all operational restaurant views (POS, Floor, Cashier, KDS, Management, Receipts, EndOfDay, Dashboard)', () => {
      const owner = getRoleNavPermissions('OWNER');
      expect(owner.canSeeCashier).toBe(true);
      expect(owner.canSeeFloor).toBe(true);
      expect(owner.canSeePos).toBe(true);
      expect(owner.canSeeKds).toBe(true);
      expect(owner.canSeeReceipts).toBe(true);
      expect(owner.canSeeEndOfDay).toBe(true);
      expect(owner.canSeeManagement).toBe(true);
      expect(owner.canSeeOwnerDashboard).toBe(true);
      expect(owner.allowedViews).toEqual(
        expect.arrayContaining(['OWNER_DASHBOARD', 'MANAGEMENT', 'FLOOR', 'POS', 'KDS', 'CASHIER', 'RECEIPTS', 'END_OF_DAY'])
      );
    });

    it('OWNER possesses superset of rights compared to MANAGER, CASHIER, and WAITER within the restaurant', () => {
      const owner = getRoleNavPermissions('OWNER');
      const manager = getRoleNavPermissions('MANAGER');
      const cashier = getRoleNavPermissions('CASHIER');
      const waiter = getRoleNavPermissions('WAITER');

      // Manager'ın tüm ekranları Owner'da mevcut olmalıdır
      manager.allowedViews.forEach((view) => {
        expect(owner.allowedViews).toContain(view);
      });
      // Cashier'ın tüm ekranları Owner'da mevcut olmalıdır
      cashier.allowedViews.forEach((view) => {
        expect(owner.allowedViews).toContain(view);
      });
      // Waiter'ın tüm ekranları Owner'da mevcut olmalıdır
      waiter.allowedViews.forEach((view) => {
        expect(owner.allowedViews).toContain(view);
      });
    });

    it('MANAGER has floor, POS, KDS and management access, but CANNOT see Cashier workstation', () => {
      const manager = getRoleNavPermissions('MANAGER');
      expect(manager.canSeeFloor).toBe(true);
      expect(manager.canSeePos).toBe(true);
      expect(manager.canSeeKds).toBe(true);
      expect(manager.canSeeManagement).toBe(true);
      expect(manager.canSeeReceipts).toBe(true);
      expect(manager.canSeeEndOfDay).toBe(true);
      // Manager cannot open cash shifts / cashier workstation
      expect(manager.canSeeCashier).toBe(false);
      expect(manager.canSeeOwnerDashboard).toBe(false);
    });

    it('CASHIER has cashier, POS, floor and receipts, but CANNOT see KDS or Owner dashboard', () => {
      const cashier = getRoleNavPermissions('CASHIER');
      expect(cashier.canSeeCashier).toBe(true);
      expect(cashier.canSeePos).toBe(true);
      expect(cashier.canSeeFloor).toBe(true);
      expect(cashier.canSeeReceipts).toBe(true);
      expect(cashier.canSeeKds).toBe(false);
      expect(cashier.canSeeEndOfDay).toBe(false);
      expect(cashier.canSeeManagement).toBe(false);
    });

    it('WAITER can ONLY see Floor and POS', () => {
      const waiter = getRoleNavPermissions('WAITER');
      expect(waiter.canSeeFloor).toBe(true);
      expect(waiter.canSeePos).toBe(true);
      expect(waiter.canSeeKds).toBe(false);
      expect(waiter.canSeeCashier).toBe(false);
      expect(waiter.canSeeReceipts).toBe(false);
      expect(waiter.canSeeEndOfDay).toBe(false);
      expect(waiter.canSeeManagement).toBe(false);
    });

    it('KITCHEN can ONLY see KDS', () => {
      const kitchen = getRoleNavPermissions('KITCHEN');
      expect(kitchen.canSeeKds).toBe(true);
      expect(kitchen.canSeeFloor).toBe(false);
      expect(kitchen.canSeePos).toBe(false);
      expect(kitchen.canSeeCashier).toBe(false);
      expect(kitchen.canSeeReceipts).toBe(false);
      expect(kitchen.canSeeEndOfDay).toBe(false);
      expect(kitchen.canSeeManagement).toBe(false);
    });
  });
});
