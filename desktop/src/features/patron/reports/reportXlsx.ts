import type { Cell, SheetData } from 'write-excel-file/browser';
import { reportCsvRows, type ReportFileMeta } from './reportCsv';
import type { ReportKey, ReportTable } from './reportDefinitions';

const columns: Record<ReportKey, Record<number, 'money' | 'count'>> = {
  SALES: { 1: 'count', 2: 'money' },
  SHIFTS: { 3: 'money', 4: 'money', 5: 'money' },
  ADJUSTMENTS: { 1: 'money' },
  STAFF: { 1: 'money', 2: 'count', 3: 'count', 4: 'money', 5: 'count' },
  PROFIT: { 1: 'money' },
};

const counts = new Set(['Adisyon', 'Vardiya', 'Şüpheli Bulgu']);

function cell(text: string, kind: 'money' | 'count' | undefined): Cell {
  if (kind === 'count' && /^-?\d+$/.test(text)) return Number(text);
  if (kind === 'money' && /^(?:≈ )?-?[\d.]+,\d{2}\s*₺$/.test(text)) {
    const value = Number(text.replace(/[≈.₺\s]/g, '').replace(',', '.'));
    return { value, format: text.startsWith('≈') ? '"≈ "#,##0.00" ₺"' : '#,##0.00" ₺"' };
  }
  return text;
}

export function reportSheet(meta: ReportFileMeta, table: ReportTable, report: ReportKey): SheetData {
  const rows = reportCsvRows(meta, table);
  const dataStart = rows.length - table.rows.length;
  const summaryStart = dataStart - table.summary.length - 2;
  return rows.map((row, index) => row.map((value, column) => {
    if (index >= dataStart) return cell(value, columns[report][column]);
    if (column === 1 && index >= summaryStart && index < dataStart - 2) {
      return cell(value, counts.has(row[0]) ? 'count' : row[0] === 'En Çok Satan' ? undefined : 'money');
    }
    return value;
  }));
}

export async function exportReport(meta: ReportFileMeta, table: ReportTable, report: ReportKey) {
  const { default: writeWorkbook } = await import('write-excel-file/browser');
  const name = meta.title.replace(/[^\p{L}\p{N}]+/gu, '-');
  await writeWorkbook(reportSheet(meta, table, report)).toFile(`${name}-${meta.from}_${meta.to}.xlsx`);
}
