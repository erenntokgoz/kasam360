/**
 * KASAM360 — SPEC §34 Rol Yetki Matrisi Doğrulama
 *
 * Bu dosya artık kodu KOPYALAMAZ. Beklenen değerler doğrudan SPEC §34'ün tablosundan
 * yazılmış sabitlerdir; implementasyondan yeniden hesaplanmaz. Böylece matris
 * değişirse ya da bozulursa test kırılır, kopyayla birlikte sessizce bozulmaz.
 */

import { ROLES, type Role } from '../../src/core/security/roles.types';
import {
  CAPABILITIES,
  CAPABILITY_MATRIX,
  accessibleViews,
  canAccessView,
  defaultViewFor,
  grantTier,
  hasCapability,
  isKnownRole,
  navigableViews,
  type Capability,
  type GrantTier,
} from '../../src/core/security/navigationMatrix';

/** SPEC §34'ün rol tablosu, test tarafına birebir kopyalanmış bağımsız kaynak. */
const SPEC_TABLE: Record<Capability, Partial<Record<Role, GrantTier>>> = {
  platformManage: { MASTER: 'FULL' },
  tenantManage: { MASTER: 'FULL' },
  featureFlags: { MASTER: 'FULL' },
  branchManage: { MASTER: 'FULL' },
  menuPricing: { OWNER: 'FULL' },
  staffManage: { OWNER: 'FULL', MANAGER: 'PARTIAL' },
  ledgerAccess: { OWNER: 'FULL', MANAGER: 'PARTIAL', CASHIER: 'PARTIAL' },
  reportsAccess: { OWNER: 'FULL', MANAGER: 'PARTIAL' },
  tableOpen: { OWNER: 'FULL', MANAGER: 'FULL', CASHIER: 'FULL', WAITER: 'FULL' },
  paymentTake: { OWNER: 'FULL', CASHIER: 'FULL', WAITER: 'CONDITIONAL' },
  shiftManage: { OWNER: 'FULL', MANAGER: 'FULL', CASHIER: 'FULL' },
  voidApprove: { OWNER: 'FULL', MANAGER: 'FULL', CASHIER: 'PIN' },
  discountApprove: { OWNER: 'FULL', MANAGER: 'FULL', CASHIER: 'PIN' },
  kdsManage: { OWNER: 'FULL', MANAGER: 'FULL', KITCHEN: 'FULL' },
  kitchenPrepare: { OWNER: 'FULL', MANAGER: 'FULL', KITCHEN: 'FULL' },
  issueReport: {
    MASTER: 'FULL',
    OWNER: 'FULL',
    MANAGER: 'FULL',
    CASHIER: 'FULL',
    WAITER: 'FULL',
    KITCHEN: 'FULL',
  },
  whatsappBot: { OWNER: 'FULL' },
  auditRaw: { MASTER: 'FULL' },
};

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('SPEC §34 — kaynak gerçeklik', () => {
  it('matristeki özellik sayısı SPEC ile aynı (18 satır)', () => {
    expect(Object.keys(CAPABILITIES)).toHaveLength(18);
  });

  it('her özellik satırı SPEC tablosuyla birebir aynı', () => {
    expect(CAPABILITY_MATRIX).toEqual(SPEC_TABLE);
  });

  it('her rol için tanımlı olmayan yetki "yok" sayılır', () => {
    const absent: Partial<Record<Capability, Role>> = {
      menuPricing: 'CASHIER',
      platformManage: 'OWNER',
      auditRaw: 'MANAGER',
      whatsappBot: 'MANAGER',
      reportsAccess: 'CASHIER',
    };
    Object.entries(absent).forEach(([capability, role]) => {
      expect(grantTier(role as Role, capability as Capability)).toBeUndefined();
      expect(hasCapability(role as Role, capability as Capability)).toBe(false);
    });
  });

  it('MASTER tenant satırlarının hiçbirine sahip değildir', () => {
    const tenantCapabilities: Capability[] = [
      'menuPricing',
      'staffManage',
      'ledgerAccess',
      'reportsAccess',
      'tableOpen',
      'paymentTake',
      'shiftManage',
      'voidApprove',
      'discountApprove',
      'kdsManage',
      'kitchenPrepare',
      'whatsappBot',
    ];
    tenantCapabilities.forEach((capability) => {
      expect(grantTier('MASTER', capability)).toBeUndefined();
    });
    // MASTER'ın sahip olduğu satırlar yalnızca platform kapsamlıdır
    expect(grantTier('MASTER', 'platformManage')).toBe('FULL');
    expect(grantTier('MASTER', 'auditRaw')).toBe('FULL');
  });

  it('PIN ve CONDITIONAL seviyeler ekran kapısı açmaz', () => {
    // Ödeme: WAITER koşullu, CASHIER tam yetkili
    expect(grantTier('WAITER', 'paymentTake')).toBe('CONDITIONAL');
    expect(canAccessView('WAITER', 'CASHIER')).toBe(false);
    expect(canAccessView('CASHIER', 'CASHIER')).toBe(true);
    // MUDUR vardiya açabiliyor ama tahsilat alamıyor
    expect(grantTier('MANAGER', 'shiftManage')).toBe('FULL');
    expect(grantTier('MANAGER', 'paymentTake')).toBeUndefined();
    expect(canAccessView('MANAGER', 'CASHIER')).toBe(false);
  });
});

describe('SPEC §34 — ekran erişimi', () => {
  const expectations: Record<Role, { views: string[]; defaultView: string }> = {
    MASTER: { views: ['PLATFORM'], defaultView: 'PLATFORM' },
    OWNER: {
      views: ['OWNER_DASHBOARD', 'MANAGEMENT', 'FLOOR', 'POS', 'KDS', 'CASHIER', 'RECEIPTS', 'END_OF_DAY'],
      defaultView: 'OWNER_DASHBOARD',
    },
    MANAGER: { views: ['MANAGEMENT', 'FLOOR', 'POS', 'KDS', 'RECEIPTS', 'END_OF_DAY'], defaultView: 'MANAGEMENT' },
    CASHIER: { views: ['CASHIER', 'POS', 'FLOOR', 'RECEIPTS', 'END_OF_DAY'], defaultView: 'CASHIER' },
    WAITER: { views: ['FLOOR', 'POS'], defaultView: 'FLOOR' },
    KITCHEN: { views: ['KDS'], defaultView: 'KDS' },
  };

  ROLES.forEach((role) => {
    it(`${role} yalnızca SPEC'teki ekranlara erişir`, () => {
      expect(sorted(accessibleViews(role))).toEqual(sorted(expectations[role].views));
    });

    it(`${role} oturum açtığında doğru ana ekrana düşer`, () => {
      expect(defaultViewFor(role)).toBe(expectations[role].defaultView);
    });

    it(`${role} için gezinme butonları erişilebilir ekranların alt kümesidir`, () => {
      navigableViews(role).forEach((view) => {
        expect(accessibleViews(role)).toContain(view);
      });
    });
  });
});

describe('SPEC §34 — gezinme çubuğu görünürlüğü', () => {
  const expectedNav: Record<Role, string[]> = {
    MASTER: [],
    OWNER: ['FLOOR', 'CASHIER', 'RECEIPTS', 'KDS', 'END_OF_DAY', 'OWNER_DASHBOARD'],
    MANAGER: ['FLOOR', 'RECEIPTS', 'KDS', 'END_OF_DAY', 'MANAGEMENT'],
    CASHIER: ['FLOOR', 'CASHIER', 'RECEIPTS', 'END_OF_DAY'],
    WAITER: ['FLOOR'],
    KITCHEN: ['KDS'],
  };

  ROLES.forEach((role) => {
    it(`${role} tam olarak ${expectedNav[role].join(', ') || 'hiçbir'} butonu görür`, () => {
      expect(sorted(navigableViews(role))).toEqual(sorted(expectedNav[role]));
    });
  });

  it('POS bir gezinme butonu değildir, sipariş Masalar ekranından başlar', () => {
    ROLES.forEach((role) => {
      expect(navigableViews(role)).not.toContain('POS');
    });
  });

  it('OWNER Yönetim butonu görmez: erişebildiği view İşletme panelini aynı bileşenle açar', () => {
    expect(canAccessView('OWNER', 'MANAGEMENT')).toBe(true);
    expect(navigableViews('OWNER')).not.toContain('MANAGEMENT');
    expect(navigableViews('MANAGER')).toContain('MANAGEMENT');
  });

  it('MASTER hiçbir gezinme butonu görmez, platform ekranı AppShell dışında açılır', () => {
    expect(navigableViews('MASTER')).toHaveLength(0);
    expect(canAccessView('MASTER', 'PLATFORM')).toBe(true);
  });
});

describe('Rol sınır güvenliği', () => {
  it('OWNER, MANAGER, CASHIER ve WAITER yetkilerinin tamamına sahiptir', () => {
    const owner = accessibleViews('OWNER');
    (['MANAGER', 'CASHIER', 'WAITER'] as Role[]).forEach((role) => {
      accessibleViews(role).forEach((view) => {
        expect(owner).toContain(view);
      });
    });
  });

  it('Masa ve mutfak rolleri birbirinin işlerine karışamaz', () => {
    expect(canAccessView('KITCHEN', 'FLOOR')).toBe(false);
    expect(canAccessView('WAITER', 'KDS')).toBe(false);
  });

  it('muhasebe ve rapor satırları mutfak ile garson rollerine kapalıdır', () => {
    ['WAITER', 'KITCHEN'].forEach((role) => {
      expect(canAccessView(role as Role, 'END_OF_DAY')).toBe(false);
    });
    expect(hasCapability('CASHIER', 'reportsAccess')).toBe(false);
  });

  it('bilinmeyen rol hiçbir ekrana erişemez', () => {
    expect(isKnownRole('SuperAdmin')).toBe(false);
    expect(isKnownRole('Owner')).toBe(false);
    expect(isKnownRole('OWNER')).toBe(true);
    ROLES.forEach((role) => expect(isKnownRole(role)).toBe(true));
  });
});
