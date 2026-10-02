import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, ReceiptText, RefreshCw } from 'lucide-react';

import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { buildPresetRange, type ReportRangePresetId } from '../reports/reportTypes';
import {
  formatCents,
  movementTypeLabel,
  type FinancialMovementDto,
} from '../../types/ledger';
import { ReceiptViewerModal } from './ReceiptViewerModal';

interface LedgerReceiptMovementsProps {
  /** Bildirim kanalı; panel kendi toast yöneticisini bilmez. */
  onNotify: (message: string, tone: 'success' | 'error') => void;
}

const RANGE_OPTIONS: readonly { id: Exclude<ReportRangePresetId, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Bugün' },
  { id: 'last7', label: 'Son 7 gün' },
  { id: 'last30', label: 'Son 30 gün' },
];

/**
 * Hesap Defteri içindeki finansal hareket paneli.
 *
 * Neden ayrı "Fişler" ekranı yok: fiş ayrı bir kayıt değil, `SALE_SETTLED`
 * tahsilatının görünümü. Bu panel hareketi listeler ve yalnızca fiş bağlantısı
 * olan satırda **"Fişi Görüntüle"** sunar; kasa ve cari hareketlerde fiş yoktur ve
 * bu durum açıkça yazılır.
 */
export function LedgerReceiptMovements({ onNotify }: LedgerReceiptMovementsProps) {
  // Rol ve tenant oturumdan gelir: backend bu iki kapıyı zorunlu tutar.
  const session = useAuthStore((state) => state.user);
  const actorRole = session?.role;
  const tenantId = session?.tenantId;

  const [preset, setPreset] = useState<Exclude<ReportRangePresetId, 'custom'>>('today');
  const [movements, setMovements] = useState<FinancialMovementDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);

  const range = useMemo(() => buildPresetRange(preset), [preset]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await tauriInvoke<FinancialMovementDto[]>('get_financial_movements', {
        from: range.from,
        to: range.to,
        actorRole,
        tenantId,
      });
      setMovements(Array.isArray(data) ? data : []);
    } catch (err) {
      setMovements([]);
      setError(err instanceof Error ? err.message : 'Finansal hareketler alınamadı.');
    } finally {
      setIsLoading(false);
    }
  }, [range.from, range.to, actorRole, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-xl">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 dark:bg-white/[0.06] bg-black/[0.04] text-[#007AFF] dark:text-blue-400 rounded-2xl border dark:border-white/10 border-black/[0.08]">
            <ReceiptText size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold dark:text-white text-zinc-900">
              Finansal Hareketler ve Fişler
            </h2>
            <p className="text-[11px] dark:text-zinc-500 text-zinc-500">
              Tahsilat kayıtlarından türetilir; fiş bilgisi olmayan hareket işaretlenir.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border dark:border-white/10 border-black/[0.08] bg-black/[0.03] dark:bg-white/[0.03] p-0.5">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPreset(option.id)}
                className={
                  preset === option.id
                    ? 'rounded-lg px-2.5 py-1 text-[11px] font-semibold dark:bg-white/[0.12] bg-black/[0.07] dark:text-white text-zinc-900'
                    : 'rounded-lg px-2.5 py-1 text-[11px] font-medium dark:text-zinc-400 text-zinc-500 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Finansal hareketleri yenile"
            className="p-2 rounded-xl border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.06] bg-black/[0.04] dark:text-zinc-200 text-zinc-700 disabled:opacity-40 hover:dark:bg-white/[0.1] hover:bg-black/[0.07] cursor-pointer"
            disabled={isLoading}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="text-xs text-[#FF453A] dark:text-[#FF6B60]">
          {error}
        </p>
      )}

      {!error && isLoading && movements.length === 0 && (
        <p className="text-xs dark:text-zinc-400 text-zinc-600">Finansal hareketler yükleniyor…</p>
      )}

      {!error && !isLoading && movements.length === 0 && (
        <p className="text-xs dark:text-zinc-400 text-zinc-600">
          Seçilen aralıkta finansal hareket bulunmuyor.
        </p>
      )}

      {movements.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs dark:text-zinc-200 text-zinc-700">
            <thead className="text-[10px] uppercase tracking-wider dark:text-zinc-400 text-zinc-500 border-b dark:border-white/10 border-black/[0.08]">
              <tr>
                <th className="py-2 pr-3 font-medium">Zaman</th>
                <th className="py-2 pr-3 font-medium">Tür</th>
                <th className="py-2 pr-3 font-medium">Açıklama</th>
                <th className="py-2 pr-3 font-medium text-right">Tutar</th>
                <th className="py-2 font-medium text-right">Fiş</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
              {movements.map((movement) => (
                <tr key={movement.movement_id}>
                  <td className="py-2.5 pr-3 whitespace-nowrap dark:text-zinc-400 text-zinc-500">
                    {new Date(movement.created_at).toLocaleString('tr-TR')}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap font-medium">{movementTypeLabel(movement.movement_type)}</td>
                  <td className="py-2.5 pr-3 dark:text-zinc-400 text-zinc-600">
                    {movement.description || '—'}
                  </td>
                  <td
                    className={
                      'py-2.5 pr-3 text-right font-mono tabular-nums ' +
                      (movement.amount_cents < 0
                        ? 'text-[#FF453A] dark:text-[#FF6B60]'
                        : 'dark:text-white text-zinc-900')
                    }
                  >
                    {formatCents(movement.amount_cents)}
                  </td>
                  <td className="py-2.5 text-right">
                    {movement.receipt_id ? (
                      <button
                        type="button"
                        onClick={() => setActiveReceiptId(movement.receipt_id as string)}
                        className="inline-flex items-center gap-1 rounded-lg border dark:border-white/10 border-black/[0.08] dark:bg-white/[0.06] bg-black/[0.04] px-2 py-1 text-[11px] font-medium dark:text-zinc-200 text-zinc-700 hover:dark:bg-white/[0.1] hover:bg-black/[0.07] cursor-pointer"
                      >
                        <Eye size={12} />
                        Fişi Görüntüle
                      </button>
                    ) : (
                      <span className="text-[11px] dark:text-zinc-500 text-zinc-400">Fiş yok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReceiptViewerModal
        receiptId={activeReceiptId}
        onClose={() => setActiveReceiptId(null)}
        onNotify={onNotify}
      />
    </section>
  );
}