import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { InlineAlert } from '../../../ui/InlineAlert';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { EDocumentCandidates } from './EDocumentCandidates';
import { EDocumentQueue } from './EDocumentQueue';
import { EDocumentSettingsForm } from './EDocumentSettingsForm';
import { overviewWarnings, type EDocumentOverview } from './eDocumentModel';

type Section = 'QUEUE' | 'CANDIDATES' | 'SETTINGS';

const SECTIONS: SectionTab<Section>[] = [
  { id: 'QUEUE', label: 'Kuyruk' },
  { id: 'CANDIDATES', label: 'Belgesiz Adisyonlar' },
  { id: 'SETTINGS', label: 'Ayarlar' },
];

/** e-Adisyon belge kuyruğu: durum, hata, yeniden deneme ve işletme kimliği ayarları. */
export const EDocumentTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [section, setSection] = useState<Section>('QUEUE');
  const [overview, setOverview] = useState<EDocumentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const loadOverview = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setOverview(await invokeIPC<EDocumentOverview>('get_e_document_overview', { actorRole, tenantId }));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview, revision]);

  const refresh = () => setRevision((value) => value + 1);
  const warnings = overview ? overviewWarnings(overview) : [];

  return (
    <div className="space-y-4">
      <SectionTabs label="e-Belge bölümleri" tabs={SECTIONS} active={section} onChange={setSection} />
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
      {warnings.map((warning) => <InlineAlert key={warning} message={warning} />)}
      {section === 'QUEUE' ? <EDocumentQueue key={revision} overview={overview} onChanged={refresh} /> : null}
      {section === 'CANDIDATES' ? <EDocumentCandidates key={revision} enabled={overview?.enabled ?? false} onChanged={refresh} /> : null}
      {section === 'SETTINGS' ? <EDocumentSettingsForm canEdit={isOwner} onSaved={refresh} /> : null}
    </div>
  );
};
