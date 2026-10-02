/**
 * Rapor dışa aktarma işlemleri.
 *
 * Neden ayrı dosya: sütun başlıkları, kuruş→metin dönüşümü ve dosya adı tek
 * yerden yönetilir. Böylece "CSV", "Excel" ve "yazdırma" seçenekleri aynı
 * satırları dışa aktarır; biri güncellenip diğeri unutulmaz.
 *
 * Kural: hiçbir dışa aktarım float'a yazmaz. `centsToExportString` kuruşu
 * Türkçe biçimde metne çevirir.
 */

import {
  AdjustmentsReport,
  ADJUSTMENT_KIND_LABELS,
  ReceiptReportRow,
  SalesReport,
  ShiftReportRow,
} from '../reportTypes';
import {
  ExportColumn,
  buildCsvBody,
  buildReportFileName,
  centsToExportString,
  downloadCsv,
  toTurkishDateTime,
} from './reportExport';

/** Bir rapor bölümünün dışa aktarım tanımı: başlık, satır sayısı ve kolonlar. */
interface ExportBundle<T> {
  prefix: string;
  rows: T[];
  columns: ExportColumn<T>[];
  /** Rapor aralığı başlığı; dosyanın ilk satırına aralık bilgisi olarak yazılır. */
  rangeLabel: string;
}

function exportFile<T>(
  bundle: ExportBundle<T>,
  excelComma: boolean,
  emptyMessage: string,
): void {
  if (bundle.rows.length === 0) {
    downloadCsv(
      buildReportFileName(bundle.prefix, 'csv'),
      buildCsvBody(
        [{ header: 'Durum', value: () => emptyMessage }],
        [{} as unknown],
        excelComma,
      ),
      excelComma,
    );
    return;
  }
  const body = buildCsvBody(bundle.columns, bundle.rows, excelComma);
  const header = buildCsvBody([{ header: 'Kapsam', value: () => bundle.rangeLabel }], [
    {} as unknown,
  ]);
  downloadCsv(
    buildReportFileName(bundle.prefix, excelComma ? 'xls' : 'csv'),
    `${header}\r\n${body}`,
    excelComma,
  );
}

export function exportSalesReport(
  sales: SalesReport | null,
  receipts: ReceiptReportRow[],
  rangeLabel: string,
  excelComma: boolean,
): void {
  const bundle: ExportBundle<SalesReport> = {
    prefix: 'satis',
    rows: sales ? [sales] : [],
    columns: [
      { header: 'Ciro', value: (row) => centsToExportString(row.total_revenue_cents) },
      { header: 'Sipariş adedi', value: (row) => row.total_orders },
      {
        header: 'Ortalama sepet',
        value: (row) => centsToExportString(row.average_order_value_cents),
      },
      { header: 'İptal toplamı', value: (row) => centsToExportString(row.voided_cents) },
      {
        header: 'Ödeme yöntemleri',
        value: (row) =>
          row.payment_methods
            .map((method) => `${method.method} ${centsToExportString(method.amount_cents)}`)
            .join(' | '),
      },
      {
        header: 'Kategori hacmi',
        value: (row) =>
          row.category_volume.map((item) => `${item.name} ${item.quantity}`).join(' | '),
      },
    ],
    rangeLabel,
  };
  if (!sales) {
    // Satış raporu okunamadıysa fiş satırlarından gerçek toplam yazılır.
    const receiptBundle: ExportBundle<ReceiptReportRow> = {
      prefix: 'satis',
      rows: receipts,
      columns: [
        { header: 'Fiş', value: (row) => row.id },
        { header: 'Masa', value: (row) => row.table_id || '-' },
        { header: 'Kasiyer', value: (row) => row.cashier_id || 'Otomatik' },
        { header: 'Tarih', value: (row) => toTurkishDateTime(row.created_at) },
        { header: 'Tutar', value: (row) => centsToExportString(row.total_cents) },
      ],
      rangeLabel,
    };
    exportFile(receiptBundle, excelComma, 'Seçili aralıkta satış kaydı yok.');
    return;
  }
  exportFile(bundle, excelComma, 'Seçili aralıkta satış kaydı yok.');
}

export function exportReceiptsReport(
  receipts: ReceiptReportRow[],
  rangeLabel: string,
  excelComma: boolean,
): void {
  exportFile(
    {
      prefix: 'fisler',
      rows: receipts,
      columns: [
        { header: 'Fiş', value: (row: ReceiptReportRow) => row.id },
        { header: 'Masa', value: (row: ReceiptReportRow) => row.table_id || '-' },
        { header: 'Kasiyer', value: (row: ReceiptReportRow) => row.cashier_id || 'Otomatik' },
        { header: 'Durum', value: (row: ReceiptReportRow) => row.status },
        { header: 'Kalem adedi', value: (row: ReceiptReportRow) => row.item_count },
        { header: 'Tarih', value: (row: ReceiptReportRow) => toTurkishDateTime(row.created_at) },
        { header: 'Tutar', value: (row: ReceiptReportRow) => centsToExportString(row.total_cents) },
      ],
      rangeLabel,
    },
    excelComma,
    'Seçili aralıkta fiş kaydı yok.',
  );
}

export function exportShiftsReport(
  shifts: ShiftReportRow[],
  rangeLabel: string,
  excelComma: boolean,
): void {
  exportFile(
    {
      prefix: 'vardiyalar',
      rows: shifts,
      columns: [
        { header: 'Vardiya', value: (row: ShiftReportRow) => row.id },
        { header: 'Kasiyer', value: (row: ShiftReportRow) => row.cashier_name || row.cashier_id },
        { header: 'Durum', value: (row: ShiftReportRow) => row.status },
        { header: 'Açılış', value: (row: ShiftReportRow) => toTurkishDateTime(row.opened_at) },
        {
          header: 'Kapanış',
          value: (row: ShiftReportRow) =>
            row.closed_at ? toTurkishDateTime(row.closed_at) : 'Açık',
        },
        {
          header: 'Beklenen',
          value: (row: ShiftReportRow) => centsToExportString(row.expected_amount_cents),
        },
        {
          header: 'Gerçek',
          value: (row: ShiftReportRow) =>
            row.actual_amount_cents === null ? '-' : centsToExportString(row.actual_amount_cents),
        },
        {
          header: 'Fark',
          value: (row: ShiftReportRow) =>
            row.difference_cents === null ? '-' : centsToExportString(row.difference_cents),
        },
      ],
      rangeLabel,
    },
    excelComma,
    'Seçili aralıkta vardiya kaydı yok.',
  );
}

export function exportAdjustmentsReport(
  adjustments: AdjustmentsReport | null,
  rangeLabel: string,
  excelComma: boolean,
): void {
  const rows = adjustments?.rows ?? [];
  exportFile(
    {
      prefix: 'iptaller',
      rows,
      columns: [
        {
          header: 'Tür',
          value: (row) => ADJUSTMENT_KIND_LABELS[row.kind] || row.kind,
        },
        { header: 'Kayıt', value: (row) => row.resource_id || '-' },
        { header: 'Sebep', value: (row) => row.reason || 'Belirtilmedi' },
        { header: 'İşlemi yapan', value: (row) => row.actor_id || '-' },
        { header: 'Onaylayan', value: (row) => row.approver_id || '-' },
        { header: 'Onaylayan rolü', value: (row) => row.approver_role || '-' },
        { header: 'Tarih', value: (row) => toTurkishDateTime(row.occurred_at) },
        { header: 'Tutar', value: (row) => centsToExportString(row.amount_cents) },
      ],
      rangeLabel,
    },
    excelComma,
    'Seçili aralıkta iptal, iade veya zayi kaydı yok.',
  );
}
