import React, { useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Input } from '../../ui/Input';

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
  'order_change:requested': 'Adisyon değişiklik talebi',
  'order_change:decided': 'Adisyon değişiklik kararı',
  'order_change:resolved': 'Adisyon değişiklik talebi kapatıldı',
  'shift:closed': 'Vardiya kapanışı',
  'shift:difference_explained': 'Kasa farkı açıklaması',
  'day:closed': 'Gün sonu',
  'backup:restored': 'Yedeğe geri dönüş',
  'approval:lockout': 'Onay PIN kilidi',
  'staff:approval_changed': 'Onay yetkisi değişikliği',
  'account:created': 'Hesap oluşturma',
  'account:signed_out': 'Hesaptan çıkış',
  'session:policy_changed': 'Oturum ayarı',
};

const filterClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

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
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

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
  const needle = search.trim().toLocaleLowerCase('tr');
  const actors = [...new Set(rows.map((row) => row.actor_id))];
  const visible = rows.filter((row) => {
    const day = row.timestamp.slice(0, 10);
    if ((action && row.action !== action) || (actor && row.actor_id !== actor) || (from && day < from) || (to && day > to)) return false;
    if (!needle) return true;
    return `${CRITICAL[row.action]} ${nameOf(row.actor_id) ?? ''} ${String(row.payload.reason ?? '')} ${String(row.payload.note ?? '')}`.toLocaleLowerCase('tr').includes(needle);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="İşlem türü" className={filterClass} value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="">Tüm işlemler</option>
          {Object.entries(CRITICAL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select aria-label="Personel" className={filterClass} value={actor} onChange={(event) => setActor(event.target.value)}>
          <option value="">Tüm personel</option>
          {actors.map((id) => (
            <option key={id} value={id}>{nameOf(id)}</option>
          ))}
        </select>
        <Input aria-label="Başlangıç tarihi" type="date" className="min-h-12 !w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input aria-label="Bitiş tarihi" type="date" className="min-h-12 !w-40" value={to} onChange={(event) => setTo(event.target.value)} />
        <Input aria-label="Ara" type="search" placeholder="Ara" className="min-h-12 !w-auto flex-1 min-w-40" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {visible.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Kayıt yok.</p> : null}
    <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
      {visible.map((row) => {
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
    </div>
  );
};
