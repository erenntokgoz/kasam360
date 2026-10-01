/**
 * SPEC §34 — Rol Yetki Matrisi: RBAC için tek kaynak gerçeklik.
 *
 * Bu modül route erişimi ile gezinme (nav) görünürlüğünü aynı veriden türetir.
 * Kural: bir ekrana ya da butona erişim "hangi yetki satırı" sorusudur, "hangi rol"
 * sorusu değildir. Rol listeleri hiçbir yerde tekrar elle yazılmaz.
 */

import { ROLES, type Role } from './roles.types';

/** Uygulamadaki tam ekran kimlikleri. */
export type AppView =
  | 'FLOOR'
  | 'POS'
  | 'MANAGEMENT'
  | 'KDS'
  | 'RECEIPTS'
  | 'END_OF_DAY'
  | 'OWNER_DASHBOARD'
  | 'CASHIER'
  | 'PLATFORM';

/**
 * Bir yetkinin rol için taşıdığı güç seviyesi.
 *
 * FULL        Yetki tam olarak role aittir.
 * PARTIAL     Yetki vardır ama kapsamı dardır (ekran içi filtre ile sınırlandırılır).
 * PIN         Yetki vardır ama anlık PIN onayı şarttır.
 * CONDITIONAL Yetki yoktur; ek bir yetkilendirme kararı verilirse açılır.
 */
export type GrantTier = 'FULL' | 'PARTIAL' | 'PIN' | 'CONDITIONAL';

/**
 * Yalnızca FULL ve PARTIAL seviyeler ekran erişimi açar.
 *
 * PIN ve CONDITIONAL seviyeler bilinçli olarak ekran kapısı sayılmaz: PIN onayı ve
 * kişi bazlı ödeme yetkisi gibi ikinci bir yetkilendirme adımı bu fazın kapsamı
 * dışındadır. Bunları "erişilebilir" saymak, onay mekanizması olmadan kapıyı açmak
 * demektir; bu yüzden seviye verilmiş olsalar bile view olarak sayılmazlar.
 */
const VIEW_GRANTING_TIERS: readonly GrantTier[] = ['FULL', 'PARTIAL'];

/** SPEC §34'ün 18 özellik satırı. Anahtar adı, satırın konusunu birebir taşır. */
export const CAPABILITIES = {
  platformManage: 'Platform Yönetimi',
  tenantManage: 'Tenant Ekle/Sil',
  featureFlags: 'Feature Flags',
  branchManage: 'Şube Ekle/Sil',
  menuPricing: 'Menü Fiyatı',
  staffManage: 'Personel Yönetimi',
  ledgerAccess: 'Hesap Defteri',
  reportsAccess: 'Raporlar',
  tableOpen: 'Masa Açma',
  paymentTake: 'Ödeme Alma',
  shiftManage: 'Vardiya Aç/Kapa',
  voidApprove: 'Void Onaylama',
  discountApprove: 'İndirim Onaylama',
  kdsManage: 'KDS Yönetimi',
  kitchenPrepare: 'Mutfak Hazırlık',
  issueReport: 'Sorun Bildir',
  whatsappBot: 'WhatsApp Bot',
  auditRaw: 'Audit Log (ham)',
} as const;

export type Capability = keyof typeof CAPABILITIES;

/**
 * SPEC §34'ün rol tablosu, birebir.
 *
 * MASTER'ın tenant satırlarında hiçbir kaydı yoktur: platform yönetimi, tenant,
 * feature flag, şube ve ham audit dışında işletme verisine erişemez. MASTER'ın
 * tenant ekranlarına erişmesi impersonation ile değil, hedef kullanıcının rolüyle
 * (bkz. ITOpsModals.tsx) mümkündür; bu yüzden bu tabloda MASTER satırları boştur.
 */
export const CAPABILITY_MATRIX: Readonly<Record<Capability, Partial<Record<Role, GrantTier>>>> = {
  platformManage: { MASTER: 'FULL' },
  tenantManage: { MASTER: 'FULL' },
  featureFlags: { MASTER: 'FULL' },
  branchManage: { MASTER: 'FULL' },

  menuPricing: { OWNER: 'FULL' },

  staffManage: { OWNER: 'FULL', MANAGER: 'PARTIAL' },

  ledgerAccess: { OWNER: 'FULL', MANAGER: 'PARTIAL', CASHIER: 'PARTIAL' },

  reportsAccess: { OWNER: 'FULL', MANAGER: 'PARTIAL' },

  tableOpen: { OWNER: 'FULL', MANAGER: 'FULL', CASHIER: 'FULL', WAITER: 'FULL' },

  // WAITER "Yetki" ile koşullu: kişi bazlı ödeme izni verilirse açılır.
  // Bu fazda ödeme ekranı açılmaz, bu yüzden CONDITIONAL.
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

/**
 * Her ekran için gereken yetki satırları. Bir role erişim açılması için listedeki
 * TÜM yetkilere sahip olması gerekir; "herhangi biri" değil.
 *
 * Bileşik koşullar bilinçlidir: bir rolün iki ayrı yetkiye de sahip olması, o
 * işi yapabileceği anlamına gelir. Örneğin CASHIER ekranı hem Ödeme Alma hem Vardiya
 * ister; bu yüzden MUDUR vardiya açabiliyor olsa da tahsilat alamaz ve kasa ekranına
 * giremez. RECEIPTS, Masa Açma ile Vardiya'nın kesişimi olduğu için WAITER'a açılmaz.
 */
const VIEW_CAPABILITIES: Readonly<Record<AppView, readonly Capability[]>> = {
  PLATFORM: ['platformManage'],
  OWNER_DASHBOARD: ['menuPricing', 'staffManage', 'reportsAccess'],
  MANAGEMENT: ['shiftManage', 'kdsManage'],
  FLOOR: ['tableOpen'],
  POS: ['tableOpen'],
  KDS: ['kdsManage'],
  CASHIER: ['paymentTake', 'shiftManage'],
  RECEIPTS: ['tableOpen', 'shiftManage'],
  END_OF_DAY: ['ledgerAccess'],
};

/**
 * Ana ekran seçimi için öncelik sırası. Rolün "ana çalışma ekranı", erişebildiği
 * en üstteki ekrandır; rol başına elle liste yazmamak, iki kaynaklığın kaynağıdır.
 */
const DEFAULT_VIEW_PRIORITY: readonly AppView[] = [
  'PLATFORM',
  'OWNER_DASHBOARD',
  'MANAGEMENT',
  'CASHIER',
  'KDS',
  'FLOOR',
  'POS',
  'RECEIPTS',
  'END_OF_DAY',
];

/**
 * Butonu olmayan ekranlar.
 *
 * POS bir gezinme öğesi değildir: sipariş akışı Masalar ekranından başlar ve POS'a
 * oradan geçilir.
 *
 * PLATFORM de öğe değildir: MASTER oturumu AppShell dışında, PlatformContainer içinde
 * açılır ve GlobalNav MASTER için hiç render edilmez.
 */
const VIEWS_WITHOUT_NAV_ITEM: readonly AppView[] = ['POS', 'PLATFORM'];

/**
 * Erişilebilir olup gezinme çubuğunda gösterilmeyen ekranlar.
 *
 * OWNER için MANAGEMENT: App.tsx bu view'da OwnerDashboardContainer açar, yani
 * "Yönetim" butonu "İşletme" butonunun birebir kopyası olurdu. Yetki kısıtı değil,
 * ekran tekrarı engelidir; bu yüzden route erişimi korunur, buton gösterilmez.
 */
const NAV_ITEM_SUPPRESSED: Readonly<Partial<Record<Role, readonly AppView[]>>> = {
  OWNER: ['MANAGEMENT'],
};

/** Rolün bir yetki satırındaki seviyesi; satır yoksa undefined. */
export function grantTier(role: Role, capability: Capability): GrantTier | undefined {
  return CAPABILITY_MATRIX[capability][role];
}

/** Rol yetkiye sahip mi? Seviyesi koşullu veya PIN ise ekran kapısı sayılmaz. */
export function hasCapability(role: Role, capability: Capability): boolean {
  const tier = grantTier(role, capability);
  return tier !== undefined && VIEW_GRANTING_TIERS.includes(tier);
}

/** Rol, view'ın gerektirdiği yetkilerin tümüne sahip mi? */
export function canAccessView(role: Role, view: AppView): boolean {
  return VIEW_CAPABILITIES[view].every((capability) => hasCapability(role, capability));
}

/** Rolün erişebildiği tüm view'lar. */
export function accessibleViews(role: Role): readonly AppView[] {
  return DEFAULT_VIEW_PRIORITY.filter((view) => canAccessView(role, view));
}

/** Rolün gezinme çubuğunda görünecek butonların açtığı view'lar. */
export function navigableViews(role: Role): readonly AppView[] {
  return DEFAULT_VIEW_PRIORITY.filter(
    (view) =>
      canAccessView(role, view) &&
      !VIEWS_WITHOUT_NAV_ITEM.includes(view) &&
      !(NAV_ITEM_SUPPRESSED[role] ?? []).includes(view),
  );
}

/**
 * Rolün ana çalışma ekranı. Erişebileceği hiç view yoksa null döner; çağıran taraf
 * kullanıcıyı güvenli ekrana (login/lock) yönlendirmekle yükümlüdür.
 */
export function defaultViewFor(role: Role): AppView | null {
  return accessibleViews(role)[0] ?? null;
}

/** Tanımsız rol güvenli tarafta kalmalıdır: hiçbir view'a erişemez. */
export function isKnownRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}
