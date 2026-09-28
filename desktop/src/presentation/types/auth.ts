export const ACTOR_ROLES = [
  'MASTER',
  'OWNER',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
] as const;

export type ActorRole = typeof ACTOR_ROLES[number];

export interface SecurityPrincipal {
  userId: string;
  role: ActorRole;
  name?: string;
  tenantId: string;
  branchId?: string;
  branchName?: string;
  activeModules?: string[];
}

export function parseActorRole(rawRole: string): ActorRole {
  if (!rawRole) return 'WAITER';
  const normalized = rawRole.toUpperCase();
  if (ACTOR_ROLES.includes(normalized as ActorRole)) {
    return normalized as ActorRole;
  }
  console.warn(`Unknown role received: ${rawRole}, defaulting to WAITER`);
  return 'WAITER';
}
