import React from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../helpers';

// Kasa farkı durum rozeti: Vardiya Aktif / Denk / Açık / Fazla
export const MutabakatBadge: React.FC<{ status: string; diff: number | null }> = ({ status, diff }) => {
  const isOpen = status?.toUpperCase() === 'OPEN';

  if (isOpen) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/25">
        <RefreshCw size={12} className="animate-spin text-amber-500" />
        <span>Vardiya Aktif</span>
      </span>
    );
  }

  if (diff === null || diff === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 size={13} />
        <span>Denk (Kasa Denk)</span>
      </span>
    );
  }

  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
        <AlertTriangle size={13} />
        <span>Açık ({formatCurrency(diff)} Fark Var)</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
      <AlertTriangle size={13} />
      <span>Fazla (+{formatCurrency(diff)} Fark Var)</span>
    </span>
  );
};

export default MutabakatBadge;
