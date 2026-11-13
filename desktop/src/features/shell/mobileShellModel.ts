import type { AppModule } from '../../stores/uiStore';
import type { ErpTab } from '../../stores/ledgerStore';
import type { FeatureFlags } from '../../types/featureFlags';
import type { UserRole } from '../../types/auth';
import { canCollectPayment, canOpenModule, canQuickSale } from '../../lib/roleAccess';

/** Hızlı işlem sayfasındaki her düğme yalnız var olan bir ekranı açar; iş kuralı burada yazılmaz. */
export type QuickActionId = 'NEW_ORDER' | 'QUICK_SALE' | 'COLLECT' | 'CASH_OUT' | 'LEDGER';

export interface QuickAction {
  id: QuickActionId;
  label: string;
  module: AppModule;
  erpTab?: ErpTab;
}

/**
 * Rolün erişebildiği ve özellik bayrağı açık olan kısayollar. Neden: kısayol, ekran korumasını
 * aşmamalı; sunucu yine de yetkiyi doğrular, ama reddedilecek düğme hiç gösterilmez.
 */
export function quickActionsFor(
  role: UserRole | undefined,
  isEnabled: (flag: keyof FeatureFlags) => boolean,
): QuickAction[] {
  const actions: QuickAction[] = [];
  if (canOpenModule(role, 'POS') && role !== 'WAITER') {
    actions.push({ id: 'NEW_ORDER', label: 'Yeni Sipariş', module: 'POS' });
  } else if (role === 'WAITER' && canOpenModule(role, 'FLOOR')) {
    actions.push({ id: 'NEW_ORDER', label: 'Yeni Sipariş', module: 'FLOOR' });
  }
  if (canQuickSale(role) && canOpenModule(role, 'POS')) {
    actions.push({ id: 'QUICK_SALE', label: 'Hızlı Satış', module: 'POS' });
  }
  if (canCollectPayment(role) && canOpenModule(role, 'CASHIER')) {
    actions.push({ id: 'COLLECT', label: 'Tahsilat', module: 'CASHIER' });
  }
  if (canOpenModule(role, 'CASHIER')) {
    actions.push({ id: 'CASH_OUT', label: 'Gider / Nakit Çıkışı', module: 'CASHIER' });
  }
  if (isEnabled('feat_ledger_cari') && canOpenModule(role, 'ERP')) {
    actions.push({ id: 'LEDGER', label: 'Cari Hareket', module: 'ERP', erpTab: 'DEBTS' });
  }
  return actions;
}
