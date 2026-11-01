import React, { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import { formatServerDateTime } from '../../../lib/date';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';

interface LogRow {
  id: string;
  createdAt: string;
  kind: string;
  status: string;
  message?: string | null;
  transactionId: string;
  amountCents: number;
}

const KIND_LABEL: Record<string, string> = {
  REQUEST: 'İstek',
  RESPONSE: 'Yanıt',
  DUPLICATE: 'Tekrarlanan yanıt',
  IGNORED: 'Yok sayılan yanıt',
  REPLAY: 'Yeniden deneme',
  VOID: 'Çekim iptali',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Bekliyor',
  APPROVED: 'Onaylandı',
  DECLINED: 'Reddedildi',
  CANCELLED: 'İptal',
};

/** Test modu açıkken kart tahsilatı sanal POS'tan geçer. Gerçek para çekilmez. */
export const TestPosPanel: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [mode, log] = await Promise.all([
        invokeIPC<boolean>('get_test_pos_mode', { tenantId }),
        invokeIPC<LogRow[]>('get_pos_payment_log', { actorRole, tenantId }),
      ]);
      setEnabled(mode);
      setRows(log);
    } catch (caught) {
      setError(String(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (next: boolean) => {
    const { actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      await invokeIPC('set_test_pos_mode', { actorRole, tenantId, enabled: next });
      await refresh();
    } catch (caught) {
      setError(String(caught));
    }
  };

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
      <h3 className="print-title text-xl">Test Sanal POS</h3>
      <p className="text-xs text-[var(--text-secondary)]">Gerçek para çekmez, gerçek sağlayıcıya bağlanmaz. Saha testi için kart tahsilatında yanıt seçtirir.</p>
      <label className="flex min-h-12 items-center gap-2 text-sm text-[var(--text-primary)]">
        <input type="checkbox" className="w-6 h-6" checked={enabled} onChange={(event) => void toggle(event.target.checked)} />
        <span>Test modunu aç</span>
      </label>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">Ödeme günlüğü boş.</p> : null}
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs text-[var(--text-primary)]">
            <span className="tabular-nums">{formatServerDateTime(row.createdAt)}</span>
            <span className="font-bold">{KIND_LABEL[row.kind] ?? row.kind}</span>
            <span>{STATUS_LABEL[row.status] ?? row.status}</span>
            <span className="tabular-nums">{formatMoney(row.amountCents)}</span>
            <span className="text-[var(--text-secondary)]">{row.message ?? ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
