import type { ReportTable } from './reportDefinitions';

export interface ReportFileMeta {
  title: string;
  /** `YYYY-AA-GG` yerel gün. */
  from: string;
  to: string;
  /** Ekranda seçili olan her filtre: etiket ve değer. */
  filters: [string, string][];
}

const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * Dosya ekrandaki `ReportTable`'dan yazılır: özet kartları, uyarı ve satırlar aynı
 * nesneden gelir. Ayrı hesap yapılmaz; ekrandaki toplam ile dosyadaki toplam ayrışamaz.
 */
export function reportCsvRows(meta: ReportFileMeta, table: ReportTable): string[][] {
  const rows: string[][] = [
    ['Rapor', meta.title],
    ['Başlangıç', meta.from],
    ['Bitiş', meta.to],
    ...meta.filters.map(([label, value]) => [label, value]),
  ];
  if (table.warning) rows.push(['Uyarı', table.warning]);
  rows.push([]);
  rows.push(...table.summary.map((item) => [item.label, item.value]));
  rows.push([]);
  rows.push(table.columns, ...table.rows);
  return rows;
}

/** Excel Türkçe karakterleri doğru açsın diye BOM ve noktalı virgül kullanılır. */
export function reportCsv(meta: ReportFileMeta, table: ReportTable): string {
  return `﻿${reportCsvRows(meta, table).map((row) => row.map(cell).join(';')).join('\r\n')}`;
}

export const reportFileName = (meta: ReportFileMeta) =>
  `${meta.title.replace(/[^\p{L}\p{N}]+/gu, '-')}-${meta.from}_${meta.to}.csv`;
