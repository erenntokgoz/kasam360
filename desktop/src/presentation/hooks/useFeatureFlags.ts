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
 * Super Admin 11 Granüler Özellik Bayrağı (Feature Flags) kancası.
 * Master rolü her zaman tüm modülleri yetkili olarak görüntüler.
 * İşletme bazında aktif olmayan modüller arayüzde ve menüde gizlenir.
 */
export function useFeatureFlags() {
  const user = useAuthStore((state) => state.user);
  const isMaster = user?.role === 'MASTER';

  const isEnabled = (key: FeatureFlagKey): boolean => {
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
