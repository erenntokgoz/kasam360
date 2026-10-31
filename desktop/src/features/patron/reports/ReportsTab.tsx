import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { RANGE_LABELS, reportPeriod, type RangeKey } from '../../../lib/dateRange';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { AccountantPanel } from './AccountantPanel';
import { REPORTS, type ReportKey, type ReportTable } from './reportDefinitions';

const RANGES: RangeKey[] = ['TODAY', 'YESTERDAY', 'WEEK', 'MONTH'];

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Excel Türkçe karakterleri doğru açsın diye BOM ve noktalı virgül kullanılır. */
function downloadCsv(name: string, table: ReportTable) {
  const lines = [table.columns, ...table.rows].map((row) => row.map(csvCell).join(';'));
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export const ReportsTab: React.FC = () => {
  const [report, setReport] = useState<ReportKey>('SALES');
  const [range, setRange] = useState<RangeKey>('WEEK');
  const [table, setTable] = useState<ReportTable | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setTable(null);
    setError(null);
    const period = reportPeriod(range);
    const { actorRole, tenantId } = sessionArgs();
    REPORTS[report]
      .load({ actorRole, tenantId, from: period.from, to: period.to })
      .then((next) => {
        if (current) setTable(next);
      })
      .catch((caught) => {
        if (current) setError(errorText(caught));
      });
    return () => {
      current = false;
    };
  }, [report, range]);

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto">
      <AccountantPanel />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rapor">
        {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
          <Button
            key={key}
            variant={report === key ? 'primary' : 'secondary'}
            className="min-h-12 text-xs font-bold"
            aria-pressed={report === key}
            onClick={() => setReport(key)}
          >
            {REPORTS[key].label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Dönem">
          {RANGES.map((key) => (
            <Button
              key={key}
              variant={range === key ? 'primary' : 'secondary'}
              className="min-h-12 text-xs font-bold"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
            >
              {RANGE_LABELS[key]}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          className="min-h-12 text-xs font-bold"
          disabled={!table || table.rows.length === 0}
          onClick={() => table && downloadCsv(`${REPORTS[report].label}-${range}`, table)}
        >
          <Download className="w-4 h-4 mr-1.5" />
          <span>Excel'e Aktar</span>
        </Button>
      </div>

      {table?.summary.length ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {table.summary.map((item) => (
            <div key={item.label} className="paper border border-[var(--border)] rounded-xl p-3">
              <span className="text-xs text-[var(--text-secondary)] block">{item.label}</span>
              <span className="text-xl font-bold tabular-nums text-[var(--text-primary)] mt-0.5 block">{item.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="p-3 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Rapor okunamadı: {error}
        </p>
      ) : !table ? (
        <p className="text-sm text-[var(--text-secondary)]">Rapor hazırlanıyor…</p>
      ) : table.rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{table.emptyText}</p>
      ) : (
        <div className="paper border border-[var(--border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                {table.columns.map((column) => (
                  <th key={column} className="font-medium px-4 py-3 whitespace-nowrap">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`} className="border-t border-[var(--border)]">
                  {row.map((cell, column) => (
                    <td key={column} className="px-4 py-2.5 tabular-nums text-[var(--text-primary)] whitespace-nowrap">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
