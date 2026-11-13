import { formatDateTime } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { utcOffsetMinutes } from '../../../lib/dateRange';
import { invokeIPC } from '../../../services/tauriClient';
import type { PanoramaData } from '../../../stores/panoramaStore';
import type { ReportArgs, ReportTable } from './reportDefinitions';

interface StockMovementWire {
  product_id: string;
  product_name: string;
  unit: string;
  is_raw: boolean;
  opening_quantity: number;
  opening_cost_cents: number | null;
  intake_quantity: number;
  intake_cost_cents: number;
  sale_quantity: number;
  sale_cost_cents: number;
  waste_quantity: number;
  waste_cost_cents: number;
  count_quantity: number;
  count_cost_cents: number;
  return_quantity: number;
  return_cost_cents: number;
  closing_quantity: number;
  closing_cost_cents: number | null;
  unknown_cost_quantity: number;
}

interface PriceChangeWire {
  product_name: string;
  old_price_cents: number;
  new_price_cents: number;
  actor_name: string;
  source: string;
  changed_at: string;
}

const wire = ({ actorRole, tenantId, from, to, productId }: ReportArgs) => ({
  actorRole,
  tenantId,
  from,
  to,
  productId: productId || null,
});

const quantityFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
/** Miktarlar birim sütunuyla ayrı yazılır; sütun sayı gibi sağa yaslanır. */
export const formatQuantity = (value: number) => quantityFormat.format(value);

const optionalMoney = (cents: number | null) => (cents === null ? '-' : formatMoney(cents));

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function costWarning(rows: StockMovementWire[]): string | undefined {
  const unknown = rows.filter((row) => row.unknown_cost_quantity > 0);
  if (unknown.length === 0) return undefined;
  const list = unknown.map((row) => `${row.product_name}: ${formatQuantity(row.unknown_cost_quantity)} ${row.unit}`).join(', ');
  return `Maliyeti bilinmeyen miktar var (${list}). Bu miktarlar maliyete sıfır yazıldı.`;
}

export async function stockMovementReport(args: ReportArgs): Promise<ReportTable> {
  const rows = await invokeIPC<StockMovementWire[]>('get_stock_movement_report', wire(args));
  return {
    summary: [
      { label: 'Giriş Maliyeti', value: formatMoney(sum(rows, (row) => row.intake_cost_cents)) },
      { label: 'Satışla Düşen Maliyet', value: formatMoney(sum(rows, (row) => row.sale_cost_cents)) },
      { label: 'Fire Maliyeti', value: formatMoney(sum(rows, (row) => row.waste_cost_cents)) },
      { label: 'Hareketli Kalem', value: String(rows.length) },
    ],
    columns: [
      'Kalem', 'Birim', 'Açılış', 'Giriş', 'Satış', 'İade', 'Fire', 'Sayım', 'Kapanış',
      'Giriş Maliyeti', 'Satış Maliyeti', 'Fire Maliyeti', 'Sayım Maliyeti',
      'Açılış Değeri (ort. maliyet)', 'Kapanış Değeri (ort. maliyet)',
    ],
    rows: rows.map((row) => [
      row.product_name, row.unit,
      formatQuantity(row.opening_quantity), formatQuantity(row.intake_quantity),
      formatQuantity(-row.sale_quantity), formatQuantity(row.return_quantity),
      formatQuantity(-row.waste_quantity), formatQuantity(row.count_quantity),
      formatQuantity(row.closing_quantity),
      formatMoney(row.intake_cost_cents), formatMoney(-row.sale_cost_cents),
      formatMoney(-row.waste_cost_cents), formatMoney(row.count_cost_cents),
      optionalMoney(row.opening_cost_cents), optionalMoney(row.closing_cost_cents),
    ]),
    emptyText: 'Bu dönemde stok hareketi yok.',
    warning: costWarning(rows),
  };
}

export async function materialUsageReport(args: ReportArgs): Promise<ReportTable> {
  const all = await invokeIPC<StockMovementWire[]>('get_stock_movement_report', wire(args));
  const used = all
    .map((row) => ({
      row,
      consumed: row.sale_quantity - row.return_quantity,
      consumedCost: row.sale_cost_cents - row.return_cost_cents,
    }))
    .filter((item) => item.consumed > 0 || item.row.waste_quantity > 0)
    .sort((a, b) => b.consumedCost + b.row.waste_cost_cents - (a.consumedCost + a.row.waste_cost_cents));
  return {
    summary: [
      { label: 'Tüketim Maliyeti', value: formatMoney(sum(used, (item) => item.consumedCost)) },
      { label: 'Fire Maliyeti', value: formatMoney(sum(used, (item) => item.row.waste_cost_cents)) },
      { label: 'Kullanılan Kalem', value: String(used.length) },
    ],
    columns: ['Kalem', 'Birim', 'Tüketilen', 'Tüketim Maliyeti', 'Fire', 'Fire Maliyeti', 'Toplam Maliyet'],
    rows: used.map(({ row, consumed, consumedCost }) => [
      row.product_name, row.unit, formatQuantity(consumed), formatMoney(consumedCost),
      formatQuantity(row.waste_quantity), formatMoney(row.waste_cost_cents),
      formatMoney(consumedCost + row.waste_cost_cents),
    ]),
    emptyText: 'Bu dönemde malzeme kullanımı yok.',
    warning: costWarning(used.map((item) => item.row)),
  };
}

const PRICE_SOURCE: Record<string, string> = { MENU_EDIT: 'Menü düzenleme', BULK_UPDATE: 'Toplu zam' };

export async function priceHistoryReport(args: ReportArgs): Promise<ReportTable> {
  const rows = await invokeIPC<PriceChangeWire[]>('get_price_history_report', wire(args));
  const raises = rows.filter((row) => row.new_price_cents > row.old_price_cents).length;
  return {
    summary: [
      { label: 'Fiyat Değişimi', value: String(rows.length) },
      { label: 'Zam', value: String(raises) },
      { label: 'İndirim', value: String(rows.length - raises) },
    ],
    columns: ['Ürün', 'Eski Fiyat', 'Yeni Fiyat', 'Fark', 'Değiştiren', 'Kaynak', 'Zaman'],
    rows: rows.map((row) => [
      row.product_name, formatMoney(row.old_price_cents), formatMoney(row.new_price_cents),
      formatMoney(row.new_price_cents - row.old_price_cents), row.actor_name,
      PRICE_SOURCE[row.source] ?? row.source, formatDateTime(row.changed_at),
    ]),
    emptyText: 'Bu dönemde fiyat değişmedi.',
  };
}

const pad = (hour: number) => String(hour % 24).padStart(2, '0');
export const hourRange = (hour: number) => `${pad(hour)}:00 - ${pad(hour + 1)}:00`;

export async function hourlySalesReport(args: ReportArgs): Promise<ReportTable> {
  const board = await invokeIPC<PanoramaData>('get_panorama', {
    actorRole: args.actorRole,
    tenantId: args.tenantId,
    from: args.from,
    to: args.to,
    compareSeconds: 86_400,
    utcOffsetMinutes: utcOffsetMinutes(),
  });
  const total = sum(board.hourly, (hour) => hour.collectedCents);
  const active = board.hourly.filter((hour) => hour.collectedCents > 0 || hour.orders > 0);
  const peak = active.reduce<(typeof active)[number] | null>(
    (best, hour) => (best === null || hour.collectedCents > best.collectedCents ? hour : best),
    null,
  );
  return {
    summary: [
      { label: 'Tahsilat', value: formatMoney(total) },
      { label: 'En Yoğun Saat', value: peak ? hourRange(peak.hour) : '-' },
    ],
    columns: ['Saat', 'Tahsilat', 'Adisyon', 'Pay'],
    rows: active.map((hour) => [
      hourRange(hour.hour),
      formatMoney(hour.collectedCents),
      String(hour.orders),
      `%${total > 0 ? Math.round((hour.collectedCents * 100) / total) : 0}`,
    ]),
    emptyText: 'Bu dönemde tahsilat yok.',
  };
}
