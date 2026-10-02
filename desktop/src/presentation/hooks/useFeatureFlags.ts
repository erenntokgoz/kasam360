import { useAuthStore } from '../store/useAuthStore';

export type FeatureFlagKey =
  | 'feat_kds'
  | 'feat_qr_menu'
  | 'feat_delivery'
  | 'feat_caller_id'
  | 'feat_table_order'
  | 'feat_seat_split'
  | 'feat_recipe_bom'
  | 'feat_dynamic_pricing'
  | 'feat_ledger_cari'
  | 'feat_multi_branch'
  | 'feat_loss_radar';

/**
 * Çok şubeli modülün açık olup olmadığını **işletmenin** modül listesinden
 * çözer (saf fonksiyon; render'a bağımlı değil, doğrudan test edilir).
 *
 * Neden rol MASTER'a "her şey açık" muafiyeti vermiyor: AGENTS.md §8'de
 * `feat_multi_branch` **KAPALI**dır ve bayrağın sahibi işletmedir. MASTER'ın
 * kendi tenant'ı olmadığı için bu bayrak MASTER için de "yönettiği işletmenin
 * modülü kapalıysa kapalı" sonucunu verir. Aksi hâlde platform konsolunda
 * kapalı bir özellik açık görünür ve 404 kuralı (AGENTS.md §3.3) ihlal edilir.
 */
export function isMultiBranchEnabledForModules(
  modules: readonly string[] | undefined,
  role: string | undefined,
): boolean {
  if (role !== 'MASTER' && !modules) return false;
  return Array.isArray(modules) && modules.includes('feat_multi_branch');
}

/**
 * Super Admin 11 Granüler Özellik Bayrağı (Feature Flags) kancası.
 * Master rolü çoğu modülü yetkili olarak görüntüler; `feat_multi_branch`
 * bu muafiyetten çıkarılır (bkz. `isMultiBranchEnabledForModules`).
 * İşletme bazında aktif olmayan modüller arayüzde ve menüde gizlenir.
 */
export function useFeatureFlags() {
  const user = useAuthStore((state) => state.user);
  const isMaster = user?.role === 'MASTER';

  const isEnabled = (key: FeatureFlagKey): boolean => {
    if (key === 'feat_multi_branch') {
      return isMultiBranchEnabledForModules(user?.activeModules, user?.role);
    }
    if (isMaster) return true;
    if (!user?.activeModules) {
      // Varsayılan açık çekirdek modüller
      const defaults: FeatureFlagKey[] = [
        'feat_kds',
        'feat_table_order',
        'feat_ledger_cari',
        'feat_recipe_bom',
        'feat_loss_radar',
      ];
      return defaults.includes(key);
    }
    return user.activeModules.includes(key);
  };

  return {
    isEnabled,
    isKdsEnabled: isEnabled('feat_kds'),
    isQrMenuEnabled: isEnabled('feat_qr_menu'),
    isDeliveryEnabled: isEnabled('feat_delivery'),
    isCallerIdEnabled: isEnabled('feat_caller_id'),
    isTableOrderEnabled: isEnabled('feat_table_order'),
    isSeatSplitEnabled: isEnabled('feat_seat_split'),
    isRecipeBomEnabled: isEnabled('feat_recipe_bom'),
    isDynamicPricingEnabled: isEnabled('feat_dynamic_pricing'),
    isLedgerCariEnabled: isEnabled('feat_ledger_cari'),
    isMultiBranchEnabled: isEnabled('feat_multi_branch'),
    isLossRadarEnabled: isEnabled('feat_loss_radar'),
  };
}
