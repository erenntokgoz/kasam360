import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';
import { DOC_TYPES, LICENSE_TYPES, POLICY_TYPES, type LegalKind, type LegalSource } from './legalRows';

interface LegalFormProps {
  /** Dolu ise form o kaydı yeniler; boşsa yeni kayıt açar. */
  editing: LegalSource | null;
  /** Eksik belge satırından gelen hazır tür. */
  preset: { kind: LegalKind; type: string } | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}

const KINDS: Record<LegalKind, string> = { DOCUMENT: 'Belge', POLICY: 'Poliçe', LICENSE: 'Müzik Lisansı' };
const TYPES: Record<LegalKind, Record<string, string>> = { DOCUMENT: DOC_TYPES, POLICY: POLICY_TYPES, LICENSE: LICENSE_TYPES };
const fieldClass = 'min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-sm text-[var(--text-primary)] border border-[var(--border)]';

const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Süre uzatma çoğu zaman yalnız tarih değiştirir: mevcut kayıt forma yüklenir. */
export const LegalForm: React.FC<LegalFormProps> = ({ editing, preset, onSaved, onCancel }) => {
  const [kind, setKind] = useState<LegalKind>('DOCUMENT');
  const [type, setType] = useState('RUHSAT');
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [issue, setIssue] = useState('');
  const [expiry, setExpiry] = useState('');
  const [amount, setAmount] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [reminder, setReminder] = useState('30');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset) {
      setKind(preset.kind);
      setType(preset.type);
      setTitle(TYPES[preset.kind][preset.type] ?? '');
    }
  }, [preset]);

  useEffect(() => {
    if (!editing) return;
    const { kind: nextKind, record } = editing;
    setKind(nextKind);
    setExpiry(record.expiry_date);
    setReminder(String(record.reminder_days));
    if (nextKind === 'DOCUMENT') {
      setType(record.doc_type);
      setTitle(record.title);
      setNumber(record.document_number ?? '');
      setIssue(record.issue_date ?? '');
    } else if (nextKind === 'POLICY') {
      setType(record.policy_type);
      setTitle(record.insurance_company);
      setNumber(record.policy_number);
      setIssue(record.issue_date);
      setAmount(money(record.premium_cents));
    } else {
      setType(record.license_type);
      setYear(String(record.year));
      setAmount(money(record.amount_cents));
    }
  }, [editing]);

  const reset = () => {
    setTitle('');
    setNumber('');
    setIssue('');
    setExpiry('');
    setAmount('');
    setReminder('30');
    setError(null);
  };

  const cents = parseCents(amount);
  const days = Number(reminder);
  const base = expiry !== '' && Number.isInteger(days) && days >= 0;
  const ready =
    kind === 'DOCUMENT' ? base && title.trim() !== ''
    : kind === 'POLICY' ? base && title.trim() !== '' && number.trim() !== '' && issue !== '' && cents !== null
    : base && cents !== null && /^\d{4}$/.test(year);

  const save = async () => {
    const session = sessionArgs();
    const record = editing?.record ?? null;
    const common = { id: record?.id ?? null, expiryDate: expiry, reminderDays: days, notes: record?.notes ?? null, isActive: true };
    setError(null);
    try {
      if (kind === 'DOCUMENT') {
        const document = editing?.kind === 'DOCUMENT' ? editing.record : null;
        await invokeIPC('save_legal_document_command', {
          ...session,
          args: { ...common, docType: type, title, authority: document?.authority ?? null, documentNumber: number || null, issueDate: issue || null, filePath: document?.file_path ?? null },
        });
      } else if (kind === 'POLICY') {
        const policy = editing?.kind === 'POLICY' ? editing.record : null;
        await invokeIPC('save_policy_command', {
          ...session,
          args: { ...common, policyType: type, insuranceCompany: title, policyNumber: number, premiumCents: cents, coverageCents: policy?.coverage_cents ?? null, issueDate: issue },
        });
      } else {
        await invokeIPC('save_music_license_command', {
          ...session,
          args: { ...common, licenseType: type, year: Number(year), amountCents: cents },
        });
      }
      reset();
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Panel title={editing ? 'Kaydı Yenile' : 'Yeni Kayıt'}>
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KINDS) as LegalKind[]).map((item) => (
            <Button
              key={item}
              variant={kind === item ? 'primary' : 'secondary'}
              className="min-h-12 text-xs"
              onClick={() => {
                setKind(item);
                setType(Object.keys(TYPES[item])[0]);
              }}
            >
              {KINDS[item]}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 items-end">
        <select aria-label="Tür" className={fieldClass} value={type} disabled={editing !== null} onChange={(event) => setType(event.target.value)}>
          {Object.entries(TYPES[kind]).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        {kind !== 'LICENSE' ? (
          <>
            <Input aria-label="Ad" placeholder={kind === 'POLICY' ? 'Sigorta şirketi' : 'Belge adı'} className="min-h-12 !w-52" value={title} onChange={(event) => setTitle(event.target.value)} />
            <Input aria-label="Numara" placeholder={kind === 'POLICY' ? 'Poliçe no' : 'Belge no'} className="min-h-12 !w-40" value={number} onChange={(event) => setNumber(event.target.value)} />
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              Düzenleme
              <Input aria-label="Düzenleme" type="date" className="min-h-12 !w-40" value={issue} onChange={(event) => setIssue(event.target.value)} />
            </label>
          </>
        ) : (
          <Input aria-label="Yıl" inputMode="numeric" placeholder="Yıl" className="min-h-12 tabular-nums !w-24" value={year} onChange={(event) => setYear(event.target.value)} />
        )}
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Bitiş
          <Input aria-label="Bitiş" type="date" className="min-h-12 !w-40" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </label>
        {kind !== 'DOCUMENT' ? (
          <Input aria-label="Tutar" inputMode="decimal" placeholder="Tutar (₺)" className="min-h-12 tabular-nums !w-36" value={amount} onChange={(event) => setAmount(event.target.value)} />
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Kaç gün önce uyar
          <Input aria-label="Uyarı günü" inputMode="numeric" className="min-h-12 tabular-nums !w-28" value={reminder} onChange={(event) => setReminder(event.target.value)} />
        </label>
        <Button variant="primary" className="min-h-12 text-xs font-bold" disabled={!ready} onClick={() => void save()}>
          Kaydet
        </Button>
        {editing ? (
          <Button
            variant="secondary"
            className="min-h-12 text-xs"
            onClick={() => {
              reset();
              onCancel();
            }}
          >
            Vazgeç
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
