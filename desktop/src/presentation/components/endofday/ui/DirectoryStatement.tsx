import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { DueBadge, DueState } from './DueBadge';

// get_directory_statement yaniti (backend/src/ledger_commands/statement.rs)
export interface StatementLine {
  id: string;
  kind: string;
  signedAmountCents: number;
  signedAmountLabel: string;
  description: string | null;
  createdAt: string;
  balanceAfterCents: number;
  balanceAfterLabel: string;
}

export interface DirectoryStatement {
  directoryId: string;
  directoryName: string;
  directoryType: string;
  openingBalanceCents: number;
  openingBalanceLabel: string;
  closingBalanceCents: number;
  closingBalanceLabel: string;
  totalDebitCents: number;
  totalCreditCents: number;
  lines: StatementLine[];
  fromDate: string;
  toDate: string;
}

// print_payment_receipt yaniti (backend/src/ledger_commands/statement.rs)
export interface PaymentReceipt {
  paymentId: string;
  directoryName: string;
  issuedAt: string;
  lines: string[];
  lineCount: number;
}

interface DirectoryStatementProps {
  directoryId: string;
  onNotify: (message: string, type: 'success' | 'error') => void;
}

const resolveLineState = (kind: string): DueState => (kind === 'SETTLEMENT' ? 'CLEARED' : 'UPCOMING');

/**
 * Cari ekstre: acilis -> satirlar -> kapanis.
 * K-5: tutar etiketleri backend DTO'sundan gelir, frontend yeniden bicimlemez.
 */
export const DirectoryStatement: React.FC<DirectoryStatementProps> = ({ directoryId, onNotify }) => {
  const [statement, setStatement] = useState<DirectoryStatement | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<DirectoryStatement>('get_directory_statement', { directoryId });
      setStatement(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [directoryId]);

  useEffect(() => {
    load();
  }, [load]);

  // K-5: lines dizisi veritabanindan turetilmis kanittir, oldugu gibi basilir.
  const handlePrintReceipt = async () => {
    try {
      const data = await invoke<PaymentReceipt>('print_payment_receipt', { directoryId });
      setReceipt(data);
      onNotify('Makbuz icerigi veritabanindan uretildi.', 'success');
    } catch (e) {
      onNotify(`Makbuz uretilemedi: ${String(e)}`, 'error');
    }
  };

  if (loading) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl flex items-center gap-2 text-sm dark:text-zinc-400 text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
        <span>Cari ekstre hesaplaniyor...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border border-red-500/30 rounded-3xl p-5 shadow-xl text-sm text-red-600 dark:text-red-400">
        Cari ekstre alinamadi: {error}
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl text-sm dark:text-zinc-400 text-zinc-500">
        Ekstre icin bir cari hesap seciniz.
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-5 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold dark:text-white text-zinc-900">{statement.directoryName}</h2>
          <p className="text-xs dark:text-zinc-400 text-zinc-500">
            {statement.fromDate} &rarr; {statement.toDate} &bull; Toplam {statement.lines.length} hareket
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrintReceipt}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.14] hover:bg-black/[0.08] dark:text-white text-zinc-900 border dark:border-white/15 border-black/10 backdrop-blur-xl shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <Printer size={14} />
          <span>Makbuz Uret</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Acilis Bakiyesi</p>
          <p className="text-sm font-semibold tabular-nums dark:text-white text-zinc-900">
            {statement.openingBalanceLabel}
          </p>
        </div>
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Borclar (GIVEN)</p>
          <p className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {statement.totalDebitCents}
          </p>
        </div>
        <div className="p-3 rounded-2xl dark:bg-white/[0.03] bg-white/60 border dark:border-white/5 border-black/[0.06]">
          <p className="text-[11px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500">Alacaklar (TAKEN)</p>
          <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {statement.totalCreditCents}
          </p>
        </div>
      </div>

      {statement.lines.length === 0 ? (
        <p className="text-xs dark:text-zinc-400 text-zinc-500 py-4 text-center">Bu donemde hareket bulunmuyor.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border dark:border-white/10 border-black/[0.06]">
          <table className="w-full text-left text-xs dark:text-zinc-300 text-zinc-700">
            <thead className="dark:bg-white/[0.03] bg-black/[0.02] text-[11px] font-semibold uppercase dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
              <tr>
                <th className="px-4 py-3">Tarih</th>
                <th className="px-4 py-3">Aciklama</th>
                <th className="px-4 py-3">Tur</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3 text-right">Bakiye</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-white/5 divide-black/[0.05]">
              {statement.lines.map((line) => (
                <tr key={line.id} data-testid={`statement-line-${line.id}`}>
                  <td className="px-4 py-3 whitespace-nowrap font-mono">{line.createdAt}</td>
                  <td className="px-4 py-3">{line.description ?? '-'}</td>
                  <td className="px-4 py-3">
                    <DueBadge state={resolveLineState(line.kind)} label={line.kind} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{line.signedAmountLabel}</td>
                  <td className="px-4 py-3 text-right font-mono">{line.balanceAfterLabel}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t dark:border-white/10 border-black/[0.08]">
              <tr>
                <td colSpan={4} className="px-4 py-3 font-semibold dark:text-white text-zinc-900">
                  Kapanis Bakiyesi
                </td>
                <td
                  data-testid="statement-closing"
                  className="px-4 py-3 text-right font-mono font-bold dark:text-white text-zinc-900"
                >
                  {statement.closingBalanceLabel}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {receipt && (
        <div className="mt-4 p-4 rounded-2xl bg-white text-zinc-900 font-mono text-[11px] shadow-xl border border-zinc-200">
          <p className="text-center font-bold tracking-wider pb-2 mb-2 border-b border-dashed border-zinc-300">
            {receipt.directoryName} &bull; {receipt.issuedAt}
          </p>
          {/* K-5: lines oldugu gibi basilir, frontend bicimlendirme yapmaz */}
          <pre className="whitespace-pre-wrap" data-testid="receipt-lines">
            {receipt.lines.join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
};

export default DirectoryStatement;