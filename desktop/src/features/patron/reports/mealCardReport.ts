import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import type { MealCardReconciliationWire } from '../../payment/mealCards';
import type { ReportArgs, ReportTable } from './reportDefinitions';

/** Yemek kartı mutabakatı: kart firmasının ödeme dökümüyle karşılaştırılacak marka bazlı toplam ve adet. */
export async function mealCardReport({ actorRole, tenantId, from, to }: ReportArgs): Promise<ReportTable> {
  const report = await invokeIPC<MealCardReconciliationWire>('get_meal_card_reconciliation', { actorRole, tenantId, from, to });
  return {
    summary: [
      { label: 'Toplam', value: formatMoney(report.totalCents) },
      { label: 'Tahsilat', value: String(report.count) },
    ],
    columns: ['Marka', 'Adet', 'Tutar'],
    rows: report.rows.map((row) => [row.label, String(row.count), formatMoney(row.totalCents)]),
    emptyText: 'Bu dönemde yemek kartı tahsilatı yok.',
  };
}
