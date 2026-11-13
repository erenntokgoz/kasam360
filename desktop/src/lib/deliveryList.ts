import type { PendingDelivery } from '../stores/deliveryStore';

export interface DeliveryGroup {
  orderId: string;
  tableName: string;
  /** "2× Tost, Çay" biçiminde, götürülecek kalemlerin tek satırı. */
  summary: string;
  itemIds: string[];
  /** Grubun en uzun bekleyen kalemi. */
  readySeconds: number;
}

/** Hazır kalemler masa (adisyon) başına toplanır; garson bir masaya tek seferde gider. */
export function groupDeliveries(items: PendingDelivery[]): DeliveryGroup[] {
  const groups = new Map<string, DeliveryGroup & { lines: string[] }>();
  for (const item of items) {
    const line = item.quantity > 1 ? `${item.quantity}× ${item.productName}` : item.productName;
    const group = groups.get(item.orderId);
    if (group) {
      group.lines.push(line);
      group.itemIds.push(item.itemId);
      group.readySeconds = Math.max(group.readySeconds, item.readySeconds);
    } else {
      groups.set(item.orderId, {
        orderId: item.orderId,
        tableName: item.tableName,
        summary: '',
        itemIds: [item.itemId],
        readySeconds: item.readySeconds,
        lines: [line],
      });
    }
  }
  return [...groups.values()]
    .map(({ lines, ...group }) => ({ ...group, summary: lines.join(', ') }))
    .sort((a, b) => b.readySeconds - a.readySeconds);
}

/** Bekleme süresi kısa yazılır: "az önce", "3 dk", "1 sa 5 dk". */
export function waitLabel(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} sa` : `${Math.floor(minutes / 60)} sa ${rest} dk`;
}

/** Bu süreyi aşan kalem soğumaya başlamıştır; satır vurgulanır. */
export const LATE_DELIVERY_SECONDS = 5 * 60;
