import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { toLocalIso } from '../../../lib/dateRange';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Panel } from '../panorama/Panel';
import { AttachmentControl } from './AttachmentControl';
import { LegalForm } from './LegalForm';
import {
  DOC_TYPES,
  daysText,
  legalRows,
  missingDocTypes,
  type LegalDocumentRow,
  type LegalKind,
  type LegalRow,
  type LegalSource,
  type LegalStatus,
  type LicenseRow,
  type PolicyRow,
} from './legalRows';

const STATUS: Record<LegalStatus, { label: string; tone: string }> = {
  EXPIRED: { label: 'Süresi doldu', tone: 'text-[var(--accent-red)]' },
  SOON: { label: 'Yaklaşıyor', tone: 'text-[var(--accent-amber)]' },
  VALID: { label: 'Geçerli', tone: 'text-[var(--accent-emerald)]' },
};

export const LegalTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [documents, setDocuments] = useState<LegalDocumentRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<LegalSource | null>(null);
  const [preset, setPreset] = useState<{ kind: LegalKind; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [nextDocuments, nextPolicies, nextLicenses, attachments] = await Promise.all([
        invokeIPC<LegalDocumentRow[]>('list_documents_command', { actorRole, tenantId, onlyActive: true }),
        invokeIPC<PolicyRow[]>('list_policies_command', { actorRole, tenantId }),
        invokeIPC<LicenseRow[]>('list_music_licenses_command', { actorRole, tenantId }),
        invokeIPC<{ ownerId: string; fileName: string }[]>('list_legal_attachments', { actorRole, tenantId }),
      ]);
      setFiles(Object.fromEntries(attachments.map((item) => [item.ownerId, item.fileName])));
      setDocuments(nextDocuments);
      setPolicies(nextPolicies);
      setLicenses(nextLicenses);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = legalRows(documents, policies, licenses, toLocalIso(new Date()).slice(0, 10));
  const missing = missingDocTypes(documents);
  const count = (status: LegalStatus) => rows.filter((row) => row.status === status).length;

  const archive = async (row: LegalRow) => {
    const session = sessionArgs();
    const { kind, record } = row.source;
    const common = { id: record.id, expiryDate: record.expiry_date, reminderDays: record.reminder_days, notes: record.notes, isActive: false };
    setError(null);
    try {
      if (kind === 'DOCUMENT') {
        await invokeIPC('save_legal_document_command', {
          ...session,
          args: { ...common, docType: record.doc_type, title: record.title, authority: record.authority, documentNumber: record.document_number, issueDate: record.issue_date, filePath: record.file_path },
        });
      } else if (kind === 'POLICY') {
        await invokeIPC('save_policy_command', {
          ...session,
          args: { ...common, policyType: record.policy_type, insuranceCompany: record.insurance_company, policyNumber: record.policy_number, premiumCents: record.premium_cents, coverageCents: record.coverage_cents, issueDate: record.issue_date },
        });
      } else {
        await invokeIPC('save_music_license_command', {
          ...session,
          args: { ...common, licenseType: record.license_type, year: record.year, amountCents: record.amount_cents },
        });
      }
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const saved = async () => {
    setEditing(null);
    setPreset(null);
    await load();
  };

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto">
      <div className="grid grid-cols-3 gap-3">
        {(['EXPIRED', 'SOON', 'VALID'] as LegalStatus[]).map((status) => (
          <div key={status} className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs text-[var(--text-secondary)]">{STATUS[status].label}</p>
            <p className={`text-2xl font-bold tabular-nums ${count(status) > 0 ? STATUS[status].tone : 'text-[var(--text-primary)]'}`}>{count(status)}</p>
          </div>
        ))}
      </div>

      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}

      {missing.length > 0 ? (
        <Panel title="Kaydı Olmayan Belgeler">
          <div className="flex flex-wrap gap-2">
            {missing.map((type) =>
              isOwner ? (
                <Button key={type} variant="secondary" className="min-h-12 text-xs" onClick={() => { setEditing(null); setPreset({ kind: 'DOCUMENT', type }); }}>
                  {DOC_TYPES[type]}
                </Button>
              ) : (
                <span key={type} className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">{DOC_TYPES[type]}</span>
              ),
            )}
          </div>
        </Panel>
      ) : null}

      <Panel title="Takvim" aside={<span className="text-xs tabular-nums text-[var(--text-secondary)]">{rows.length} kayıt</span>}>
        {rows.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Henüz kayıt yok.</p> : null}
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-3 min-h-12 py-1 border-b border-[var(--border)] last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{row.title}</span>
                <span className="block text-xs text-[var(--text-secondary)] truncate">{row.type}{row.detail ? ` · ${row.detail}` : ''}</span>
              </span>
              <span className="text-right">
                <span className={`block text-xs font-bold tabular-nums ${STATUS[row.status].tone}`}>{daysText(row.daysLeft)}</span>
                <span className="block text-xs tabular-nums text-[var(--text-secondary)]">{row.expiryDate}</span>
              </span>
              <AttachmentControl
                ownerId={row.source.record.id}
                fileName={files[row.source.record.id] ?? null}
                canEdit={isOwner}
                onChanged={load}
                onError={(caught) => setError(errorText(caught))}
              />
              {isOwner ? (
                <>
                  <Button variant="secondary" className="min-h-12 text-xs" onClick={() => { setPreset(null); setEditing(row.source); }}>Yenile</Button>
                  <Button variant="ghost" className="min-h-12 text-xs" onClick={() => void archive(row)}>Arşivle</Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>

      {isOwner ? <LegalForm key={editing ? 'edit' : 'new'} editing={editing} preset={preset} onSaved={saved} onCancel={() => setEditing(null)} /> : null}
    </div>
  );
};
