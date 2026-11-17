import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { formatStamp, type EDocumentCandidate } from './eDocumentModel';

interface Props {
  enabled: boolean;
  onChanged: () => void;
}

/** Kapanmış ama kuyrukta satırı olmayan adisyonlar; taslak yalnız burada kullanıcı onayıyla açılır. */
export const EDocumentCandidates: React.FC<Props> = ({ enabled, onChanged }) => {
  const [rows, setRows] = useState<EDocumentCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setRows(await invokeIPC<EDocumentCandidate[]>('list_e_document_candidates', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createDraft = async (orderId: string) => {
    if (busyId) return;
    setBusyId(orderId);
    setError(null);
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC('create_e_document_draft', { actorRole, actorId, tenantId, orderId });
      onChanged();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {!enabled ? <InlineAlert message="e-Adisyon kapalı; taslak oluşturmak için Ayarlar bölümünden açın." /> : null}
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
      {rows === null && !error ? <p role="status" className="text-sm">Adisyonlar yükleniyor.</p> : null}
      {rows?.length === 0 ? <p className="text-sm">Belgesiz kapanmış adisyon yok.</p> : null}
      {rows && rows.length > 0 ? (
        <div className="work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left"><th>Masa</th><th>Kapanış</th><th className="text-right">Tutar</th><th><span className="sr-only">İşlem</span></th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td className="font-bold">{row.tableName}</td>
                  <td className="tabular-nums">{formatStamp(row.closedAt)}</td>
                  <td className="text-right tabular-nums">{formatMoney(row.totalCents)}</td>
                  <td className="text-right">
                    <Button size="sm" variant="primary" disabled={!enabled || busyId !== null}
                      isLoading={busyId === row.orderId} onClick={() => void createDraft(row.orderId)}>
                      Taslak Oluştur
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};
