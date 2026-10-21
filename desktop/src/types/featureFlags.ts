export interface FeatureFlags {
  feat_kds: boolean;
  feat_qr_menu: boolean;
  feat_delivery: boolean;
  feat_caller_id: boolean;
  feat_table_order: boolean;
  feat_seat_split: boolean;
  feat_recipe_bom: boolean;
  feat_dynamic_pricing: boolean;
  feat_ledger_cari: boolean;
  feat_multi_branch: boolean;
  feat_loss_radar: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  feat_kds: true,
  feat_qr_menu: true,
  feat_delivery: false,
  feat_caller_id: false,
  feat_table_order: true,
  feat_seat_split: false,
  feat_recipe_bom: true,
  feat_dynamic_pricing: false,
  feat_ledger_cari: true,
  feat_multi_branch: false,
  feat_loss_radar: true,
};
