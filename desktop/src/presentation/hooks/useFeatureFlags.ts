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
 * AGENTS.md §8'in bayrak tablosu — tek kaynak.
 *
 * Neden burada: `isEnabled` içindeki `defaults` dizisi bu tablonun **kopyasıydı**
 * ve iki liste ayrışmıştı. Bayrak açık ilan edilip kodu olmayan bir bayrak
 * (ör. `feat_seat_split`) arayüzde görünür ama hiçbir komuta karşılık gelmez;
 * kullanıcı çalışmayan bir düğme görür. Tablo burada tek yerde durur ve
 * varsayılanlar da buradan okunur.
 */
const FEATURE_FLAG_AKIS_DEGERI: Readonly<Record<FeatureFlagKey, 'ACIK' | 'KAPALI'>> = {
  feat_kds: 'ACIK',
  feat_qr_menu: 'ACIK',
  // Paket servis henüz uygulanmadı; komutu da yok.
  feat_delivery: 'KAPALI',
  // Çağrı cihazı entegrasyonu uygulanmadı; komutu da yok.
  feat_caller_id: 'KAPALI',
  feat_table_order: 'ACIK',
  // Koltuk bazlı sipariş (`seat_number`) kod tabanında hiç yok. Bayrak AÇIK
  // ilan edildiği hâlde arkasında komut bulunmadığı için arayüz çalışmayan bir
  // özellik gösteriyordu. Kod yazılana kadar KAPALI.
  feat_seat_split: 'KAPALI',
  feat_recipe_bom: 'ACIK',
  feat_dynamic_pricing: 'KAPALI',
  feat_ledger_cari: 'ACIK',
  feat_multi_branch: 'KAPALI',
  feat_loss_radar: 'ACIK',
};

/** Modül listesi taşınmadığında açık sayılan bayraklar (AGENTS.md §8'den). */
export const DEFAULT_OPEN_FEATURE_FLAGS: readonly FeatureFlagKey[] = (
  Object.entries(FEATURE_FLAG_AKIS_DEGERI) as [FeatureFlagKey, 'ACIK' | 'KAPALI'][]
)
  .filter(([, deger]) => deger === 'ACIK')
  .map(([bayrak]) => bayrak);

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
 * Bir bayrağın açık olup olmadığını **oturumun modül listesinden** çözer.
 * Saf fonksiyon: render'a bağımlı değildir, doğrudan test edilir.
 *
 * Neden rol muafiyeti yok: AGENTS.md §3.3 bayrak kapalıyken yüzeyin 404
 * vermesini zorunlu kılar. MASTER'a "her şey açık" muafiyeti bu kuralı her
 * bayrakta delerdi. Tek doğruluk kaynağı oturumun modül listesidir: MASTER
 * girişinde backend `auth_commands::master_modules()` listesini gönderir ve
 * o listede kod tabanında karşılığı olmayan bayrak yoktur.
 */
export function isFeatureEnabledForModules(
  key: FeatureFlagKey,
  modules: readonly string[] | undefined,
  role: string | undefined,
): boolean {
  if (key === 'feat_multi_branch') {
    return isMultiBranchEnabledForModules(modules, role);
  }
  if (!modules) {
    // Liste yoksa AGENTS.md §8 tablosu okunur; kodu olmayan bayrak yine kapalıdır.
    return DEFAULT_OPEN_FEATURE_FLAGS.includes(key);
  }
  return modules.includes(key);
}

/** Super Admin 11 Granüler Özellik Bayrağı (Feature Flags) kancası. */
export function useFeatureFlags() {
  const user = useAuthStore((state) => state.user);

  const isEnabled = (key: FeatureFlagKey): boolean =>
    isFeatureEnabledForModules(key, user?.activeModules, user?.role);

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
