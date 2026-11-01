import type { AppModule } from '../stores/uiStore';
import type { UserRole } from '../types/auth';

const OPERATIONS: AppModule[] = ['FLOOR', 'POS', 'KDS', 'CASHIER'];

const MODULES: Record<UserRole, AppModule[]> = {
  MASTER: [...OPERATIONS, 'ERP', 'SETTINGS'],
  OWNER: [...OPERATIONS, 'ERP', 'SETTINGS'],
  MANAGER: [...OPERATIONS, 'ERP', 'SETTINGS'],
  CASHIER: OPERATIONS,
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
  return canOpenModule(role, 'CASHIER');
}
