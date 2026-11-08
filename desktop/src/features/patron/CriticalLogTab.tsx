import { ErrorToast } from '../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
import { localDate, errorText } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { RecordCard } from './RecordCard';

interface AuditRow {
  id: string;
  timestamp: string;
  actor_id: string;
  action: string;
  resource_id?: string;
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
  const [from, setFrom] = useState(() => localDate(new Date()));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const pageSize = 40;

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    let current = true;
    invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId, includeInactive: true })
      .then((staff) => { if (current) setNames(Object.fromEntries(staff.map((member) => [member.id, member.name]))); })
      .catch(() => { if (current) setNames({}); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    const { actorRole, tenantId } = sessionArgs();
    setRows(null);
    setError(null);
    invokeIPC<AuditRow[]>('get_audit_logs', {
      callerRole: actorRole, tenantId,
      filter: {
        actions: action ? [action] : Object.keys(CRITICAL),
        staffId: actor || null,
        startDate: from || null,
        endDate: to ? `${to}T23:59:59.999999999Z` : null,
        search: search.trim() || null,
        limit: pageSize + 1,
        offset: page * pageSize,
      },
    }).then((logs) => { if (current) setRows(logs); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [action, actor, from, to, search, page]);

  const nameOf = (id: unknown) => (typeof id === 'string' ? names[id] ?? id : null);
  const visible = rows?.slice(0, pageSize) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="İşlem türü" className={filterClass} value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}>
          <option value="">Tüm işlemler</option>
          {Object.entries(CRITICAL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select aria-label="Personel" className={filterClass} value={actor} onChange={(event) => { setActor(event.target.value); setPage(0); }}>
          <option value="">Tüm personel</option>
          {Object.keys(names).map((id) => (
            <option key={id} value={id}>{nameOf(id)}</option>
          ))}
        </select>
        <Input aria-label="Başlangıç tarihi" type="date" className="min-h-12 !w-40" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} />
        <Input aria-label="Bitiş tarihi" type="date" className="min-h-12 !w-40" value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} />
        <Input aria-label="Ara" type="search" className="min-h-12 !w-auto flex-1 min-w-40" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      </div>
      {error ? <ErrorToast message={error} /> : null}
      {!rows && !error ? <p role="status">Kayıtlar yükleniyor.</p> : null}
      {rows && visible.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Kayıt yok.</p> : null}
      {visible.length > 0 ? (
        <ul className="grid gap-2 md:grid-cols-2">
          {visible.map((row) => {
            const amount = amountOf(row.payload);
            return (
              <li key={row.id}>
                <RecordCard title={CRITICAL[row.action] ?? row.action}
                  description={`${formatDateTime(row.timestamp)} · ${nameOf(row.actor_id) ?? 'Personel belirtilmemiş'}`}
                  value={amount === null ? undefined : formatMoney(amount)} onOpen={() => setSelected(row)} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {selected ? <CriticalRecord row={selected} nameOf={nameOf} onClose={() => setSelected(null)} /> : null}
      <nav aria-label="Kritik kayıt sayfaları" className="flex items-center gap-2">
        <Button disabled={page === 0 || !rows} onClick={() => setPage(page - 1)}>Önceki</Button>
        <span className="tabular-nums">{page + 1}. sayfa</span>
        <Button disabled={(rows?.length ?? 0) <= pageSize} onClick={() => setPage(page + 1)}>Sonraki</Button>
      </nav>
    </div>
  );
};

function CriticalRecord({ row, nameOf, onClose }: {
  row: AuditRow;
  nameOf: (id: unknown) => string | null;
  onClose: () => void;
}) {
  const amount = amountOf(row.payload);
  const approver = nameOf(row.payload.approverId);
  const detail = [row.payload.reason, row.payload.note].find((text): text is string => typeof text === 'string');
  return (
    <Modal cardFlow isOpen title={CRITICAL[row.action] ?? row.action} subtitle={formatDateTime(row.timestamp)} onClose={onClose}>
      <dl className="space-y-3 text-sm">
        <div><dt className="font-semibold">İşlemi Yapan</dt><dd>{nameOf(row.actor_id) ?? 'Belirtilmemiş'}</dd></div>
        {approver ? <div><dt className="font-semibold">Onaylayan</dt><dd>{approver}</dd></div> : null}
        {amount === null ? null : <div><dt className="font-semibold">Tutar</dt><dd className="tabular-nums">{formatMoney(amount)}</dd></div>}
        {row.resource_id ? <div><dt className="font-semibold">Kayıt</dt><dd className="break-all">{row.resource_id}</dd></div> : null}
        {detail ? <div><dt className="font-semibold">Açıklama</dt><dd className="break-words">{detail}</dd></div> : null}
      </dl>
    </Modal>
  );
}
