import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';

interface AuditRow {
  id: string;
  timestamp: string;
  actor_id: string;
  action: string;
  payload: Record<string, unknown>;
}

interface StaffRow {
  id: string;
  name: string;
}

const CRITICAL: Record<string, string> = {
  'compensation:refund': 'İade',
  'order_item:voided': 'Kalem iptali',
  'order_item:comped': 'İkram',
  'order:voided': 'Adisyon iptali',
  'shift:closed': 'Vardiya kapanışı',
  'shift:difference_explained': 'Kasa farkı açıklaması',
  'day:closed': 'Gün sonu',
  'approval:lockout': 'Onay PIN kilidi',
  'staff:approval_changed': 'Onay yetkisi değişikliği',
  'account:created': 'Hesap oluşturma',
  'account:signed_out': 'Hesaptan çıkış',
  'session:policy_changed': 'Oturum ayarı',
};

const AMOUNT_KEYS = ['amountCents', 'orderTotalCents', 'originalAmountCents', 'differenceCents'];

function amountOf(payload: AuditRow['payload']): number | null {
  const key = AMOUNT_KEYS.find((name) => typeof payload[name] === 'number');
  return key ? (payload[key] as number) : null;
}

/** Patron ve müdürün gördüğü değiştirilemez kritik işlem listesi. */
export const CriticalLogTab: React.FC = () => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    Promise.all([
      invokeIPC<AuditRow[]>('get_audit_logs', { callerRole: actorRole, tenantId, filter: { limit: 500 } }),
      invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId, includeInactive: true }),
    ])
      .then(([logs, staff]) => {
        setRows(logs.filter((log) => log.action in CRITICAL));
        setNames(Object.fromEntries(staff.map((member) => [member.id, member.name])));
      })
      .catch((caught) => setError(errorText(caught)));
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
        Kritik işlemler okunamadı: {error}
      </p>
    );
  }
  if (!rows) return <p className="text-sm text-[var(--text-secondary)]">Yükleniyor…</p>;
  if (rows.length === 0) return <p className="text-sm text-[var(--text-secondary)]">Kritik işlem yok.</p>;

  const nameOf = (id: unknown) => (typeof id === 'string' ? names[id] ?? id : null);

  return (
    <ul className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
      {rows.map((row) => {
        const amount = amountOf(row.payload);
        const approver = nameOf(row.payload.approverId);
        const detail = [row.payload.reason, row.payload.note].find((text) => typeof text === 'string') as
          | string
          | undefined;
        return (
          <li key={row.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--text-primary)]">{CRITICAL[row.action]}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {formatDateTime(row.timestamp)} · {nameOf(row.actor_id)}
                {approver ? ` · Onaylayan: ${approver}` : ''}
              </p>
              {detail ? <p className="text-xs text-[var(--text-secondary)] mt-0.5">{detail}</p> : null}
            </div>
            {amount !== null ? (
              <span className="text-sm font-bold tabular-nums text-[var(--text-primary)] shrink-0">
                {formatMoney(amount)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
