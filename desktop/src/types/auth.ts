export type UserRole = 'MASTER' | 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export interface UserSession {
  userId: string;
  name: string;
  role: UserRole;
  tenantId: string;
  activeModules?: string[];
  token?: string;
  mustChangePin?: boolean;
  /** Kurye etiketi: etiketsiz garson Paket ekranını görmez. */
  isCourier?: boolean;
}

export interface AuthState {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  idleSecondsLeft: number;
}
