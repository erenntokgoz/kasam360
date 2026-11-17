import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Badge } from '../../../ui/Badge';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { Modal } from '../../../ui/Modal';
import {
  REMOTE_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  canRetry,
  canSubmit,
  formatStamp,
  type DispatchReport,
  type EDocumentEntry,
  type EDocumentOverview,
} from './eDocumentModel';

interface Props {
  overview: EDocumentOverview | null;
  onChanged: () => void;
}

/** Belge kuyruğu: her satır tek belgedir; ETTN ve belge numarası sağlayıcı başvurusunda kullanılır. */
export const EDocumentQueue: React.FC<Props> = ({ overview, onChanged }) => {
  const [rows, setRows] = useState<EDocumentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DispatchReport | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [xml, setXml] = useState<{ title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setRows(await invokeIPC<EDocumentEntry[]>('list_e_documents', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, work: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(key);
    setError(null);
    try {
      await work();
      onChanged();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const act = (entry: EDocumentEntry, command: string) => run(entry.id, async () => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC(command, { actorRole, actorId, tenantId, documentId: entry.id });
  });

  const dispatch = () => run('dispatch', async () => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    setReport(await invokeIPC<DispatchReport>('dispatch_e_documents', { actorRole, actorId, tenantId }));
  });

  const showXml = (entry: EDocumentEntry) => run(entry.id, async () => {
    const { actorRole, tenantId } = sessionArgs();
    const body = await invokeIPC<string>('get_e_document_xml', { actorRole, tenantId, documentId: entry.id });
    setXml({ title: entry.documentNumber, body });
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm tabular-nums">
          {overview
            ? `Taslak ${overview.counts.draft} · Gönderilecek ${overview.counts.pending} · Gönderildi ${overview.counts.sent} · Hata ${overview.counts.failed}`
            : null}
        </p>
        <Button variant="primary" isLoading={busyId === 'dispatch'}
          disabled={!overview?.enabled || overview.counts.pending === 0} onClick={() => void dispatch()}>
          <Send size={16} aria-hidden="true" />Şimdi Gönder
        </Button>
      </div>
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
      {report ? (
        <p role="status" className="text-sm tabular-nums">
          Son gönderim: {report.sent} gönderildi, {report.failed} hata, {report.deferred} bekletildi.
        </p>
      ) : null}
      {rows === null && !error ? <p role="status" className="text-sm">Belgeler yükleniyor.</p> : null}
      {rows?.length === 0 ? <p className="text-sm">Kuyrukta belge yok.</p> : null}
      {rows && rows.length > 0 ? (
        <div className="work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Belge No</th><th>Durum</th><th className="text-right">Deneme</th>
                <th className="text-right">Tutar</th><th>Son hata</th><th>Güncelleme</th>
                <th><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-bold tabular-nums">
                    {entry.documentNumber}
                    <span className="block break-all text-xs font-normal">{entry.ettn}</span>
                  </td>
                  <td>
                    <Badge variant={STATUS_VARIANT[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
                    {entry.remoteStatus ? <span className="block text-xs">{REMOTE_LABEL[entry.remoteStatus] ?? entry.remoteStatus}</span> : null}
                  </td>
                  <td className="text-right tabular-nums">{entry.attempts}</td>
                  <td className="text-right tabular-nums">{formatMoney(entry.totalCents)}</td>
                  <td className="max-w-72 break-words">{entry.lastError ?? ''}</td>
                  <td className="tabular-nums">{formatStamp(entry.updatedAt)}</td>
                  <td className="whitespace-nowrap text-right">
                    {canSubmit(entry) ? (
                      <>
                        <Button size="sm" disabled={busyId !== null} onClick={() => void act(entry, 'rebuild_e_document_draft')}>Yeniden Kur</Button>
                        <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => void act(entry, 'submit_e_document')}>Gönderilecek Yap</Button>
                      </>
                    ) : null}
                    {canRetry(entry) ? (
                      <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => void act(entry, 'retry_e_document')}>
                        <RefreshCw size={16} aria-hidden="true" />Yeniden Dene
                      </Button>
                    ) : null}
                    {entry.status === 'SENT' ? (
                      <Button size="sm" disabled={busyId !== null} onClick={() => void act(entry, 'refresh_e_document_status')}>Durum Sorgula</Button>
                    ) : null}
                    <Button size="sm" disabled={busyId !== null} onClick={() => void showXml(entry)}>XML</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {xml ? (
        <Modal isOpen title={`Belge ${xml.title}`} maxWidth="3xl" onClose={() => setXml(null)}>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-xs">{xml.body}</pre>
        </Modal>
      ) : null}
    </div>
  );
};
