import type { UserRole } from '../types/auth';

export function canUseOperations(role: UserRole | undefined): boolean {
  return role !== undefined && role !== 'MASTER';
}
