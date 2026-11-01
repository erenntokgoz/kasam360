import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { downloadFile } from '../../../lib/downloadFile';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';

/** Kaldırılan yasal modülün kaydı varsa görünür; kayıt silinmez, yalnız dosya verilir. */
export const LegacyArchivePanel: React.FC = () => {
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<{ recordCount: number }>('get_legacy_archive_status', { actorRole, tenantId })
      .then((status) => setCount(status.recordCount))
      .catch((caught) => setError(errorText(caught)));
  }, []);

  const download = async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const archive = await invokeIPC<unknown>('export_legacy_archive', { actorRole, tenantId });
      downloadFile('yasal-kayit-arsivi.json', JSON.stringify(archive, null, 2), 'application/json');
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  if (count === 0 && !error) return null;
  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-2">
      <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">Yasal Kayıt Arşivi</h3>
      <p className="text-xs text-[var(--text-secondary)]">
        Yasal modül üründen kaldırıldı. Daha önce girilen {count} kayıt silinmedi ve yedeğe dahildir.
      </p>
      <Button variant="secondary" className="min-h-12 text-sm" onClick={() => void download()}>Arşivi İndir</Button>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </section>
  );
};
