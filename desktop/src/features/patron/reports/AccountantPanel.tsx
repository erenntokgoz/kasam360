import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { downloadFile } from '../../../lib/downloadFile';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Panel } from '../panorama/Panel';

interface ReportBody {
  tahsilat_cents: number;
  iptal_cents: number;
  siparis_adedi: number;
  kalan_borc_cents: number;
}

/** Müşavir ağa bağlanmaz: imzalı rapor dosya olarak verilir. Yalnız sahip üretir. */
export const AccountantPanel: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [body, setBody] = useState<ReportBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!isOwner) return null;

  const build = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    setBody(null);
    try {
      const json = await invokeIPC<string>('accountant_report_build', {
        actorId, actorRole, tenantId, periodStart: from, periodEnd: to,
      });
      const signed = JSON.parse(json) as { govde: ReportBody };
      setBody(signed.govde);
      downloadFile(`mali-musavir-${from}-${to}.json`, json, 'application/json');
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Panel title="Mali Müşavir Raporu">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Rapor başlangıcı" type="date" className="min-h-12 !w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input aria-label="Rapor bitişi" type="date" className="min-h-12 !w-40" value={to} onChange={(event) => setTo(event.target.value)} />
        <Button variant="primary" className="min-h-12 text-xs font-bold" disabled={from === '' || to === ''} onClick={() => void build()}>
          İmzalı Rapor İndir
        </Button>
      </div>
      {body ? (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs text-[var(--text-secondary)]">Tahsilat</dt><dd className="font-bold tabular-nums">{formatMoney(body.tahsilat_cents)}</dd></div>
          <div><dt className="text-xs text-[var(--text-secondary)]">İptal</dt><dd className="font-bold tabular-nums">{formatMoney(body.iptal_cents)}</dd></div>
          <div><dt className="text-xs text-[var(--text-secondary)]">Adisyon</dt><dd className="font-bold tabular-nums">{body.siparis_adedi}</dd></div>
          <div><dt className="text-xs text-[var(--text-secondary)]">Kalan Cari</dt><dd className="font-bold tabular-nums">{formatMoney(body.kalan_borc_cents)}</dd></div>
        </dl>
      ) : null}
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </Panel>
  );
};
