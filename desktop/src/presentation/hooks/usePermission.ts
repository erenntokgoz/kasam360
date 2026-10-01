/**
 * Yetki okuma kancası.
 *
 * Bileşenler rol listelerini elle yazmaz; SPEC §34 matrisini okur. Kullanıcı yoksa
 * "hiçbir şey yapamayan" profili döner: izin kontrolü sessizce geçilmesin diye
 * bilinçli olarak en kapalı durum varsayılır.
 */

import { useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import {
  accessibleViews,
  canAccessView as matrixCanAccessView,
  grantTier as matrixGrantTier,
  hasCapability as matrixHasCapability,
  navigableViews as matrixNavigableViews,
  type AppView,
  type Capability,
  type GrantTier,
} from '../../core/security/navigationMatrix';
import type { ActorRole } from '../types/auth';

export interface PermissionProfile {
  /** Oturumdaki gerçek rol; oturum yoksa null. */
  readonly role: ActorRole | null;
  /** Erişilebilir tüm ekranlar (route guard ile aynı kaynak). */
  readonly views: readonly AppView[];
  /** Gezinme çubuğunda görünecek ekranlar. */
  readonly navViews: readonly AppView[];
  /** Rol yetki satırına sahip mi? PIN/CONDITIONAL ekran kapısı sayılmaz. */
  can: (capability: Capability) => boolean;
  /** Yetkinin güç seviyesi; satır yoksa undefined. */
  tier: (capability: Capability) => GrantTier | undefined;
  /** Rol bu ekrana erişebilir mi? */
  canOpen: (view: AppView) => boolean;
}

const DENY_ALL: PermissionProfile = {
  role: null,
  views: [],
  navViews: [],
  can: () => false,
  tier: () => undefined,
  canOpen: () => false,
};

export function usePermission(): PermissionProfile {
  const role = useAuthStore((state) => state.user?.role ?? null);

  return useMemo<PermissionProfile>(() => {
    if (role === null) return DENY_ALL;
    return {
      role,
      views: accessibleViews(role),
      navViews: matrixNavigableViews(role),
      can: (capability) => matrixHasCapability(role, capability),
      tier: (capability) => matrixGrantTier(role, capability),
      canOpen: (view) => matrixCanAccessView(role, view),
    };
  }, [role]);
}
