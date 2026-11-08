import type { AppModule } from '../stores/uiStore';
import type { UserRole } from '../types/auth';

const OPERATIONS: AppModule[] = ['FLOOR', 'POS', 'KDS', 'CASHIER'];
const BUSINESS_PAGES: AppModule[] = [...OPERATIONS, 'ERP', 'CATALOG', 'SETTINGS'];

// Sunucu yetkisiyle aynı harita: açılıp yetki hatası veren ekran menüde görünmez.
// Garson mutfak durumunu izler ve siparişi masa içinden açar.
const MODULES: Record<UserRole, AppModule[]> = {
  MASTER: [],
  OWNER: [...OPERATIONS, 'ERP', 'CATALOG', 'SETTINGS'],
  MANAGER: BUSINESS_PAGES,
  CASHIER: ['FLOOR', 'POS', 'KDS', 'CASHIER'],
  WAITER: ['FLOOR', 'POS', 'KDS'],
  KITCHEN: ['KDS'],
};

export function canOpenModule(role: UserRole | undefined, module: AppModule): boolean {
  return role ? MODULES[role].includes(module) : false;
}

/** Oturum yeni açıldığında rolün çalıştığı ilk ekran. */
export function homeModule(role: UserRole): AppModule {
  return MODULES[role][0];
}

/** Tahsilat düğmesi sunucu reddine güvenip gösterilmez: garson para alamaz. */
export function canCollectPayment(role: UserRole | undefined): boolean {
  return role === 'OWNER' || role === 'CASHIER';
}
