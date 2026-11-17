import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { Input } from '../../../ui/Input';
import { NumberInput } from '../../../ui/NumberInput';

type ConnectionKind = 'SERIAL' | 'USB' | 'TCP' | 'SIMULATOR';

export interface OkcSettingsWire {
  enabled: boolean;
  connectionKind: ConnectionKind;
  port: string;
  baudRate: number;
  responseTimeoutMs: number;
  terminalSerial: string;
}

interface OkcConnectionStatus {
  connected: boolean;
  code: string | null;
  message: string;
}

export interface OkcFailure {
  id: string;
  transactionId: string;
  orderId: string | null;
  totalCents: number;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  updatedAt: string;
}

const KIND_LABEL: Record<Exclude<ConnectionKind, 'SIMULATOR'>, string> = {
  SERIAL: 'Seri port',
  USB: 'USB',
  TCP: 'Ağ (IP:port)',
};

const PORT_LABEL: Record<ConnectionKind, string> = {
  SERIAL: 'Port adı (örn. COM3)',
  USB: 'Port adı (örn. COM4)',
  TCP: 'Adres (örn. 192.168.1.50:9000)',
  SIMULATOR: 'Simülatör',
};

/** Yazar kasa (ÖKC) bağlantısı, deneme ve fişi kesilemeyen tahsilatlar. */
export const OkcSettings: React.FC<{ canEdit: boolean; canTest: boolean }> = ({ canEdit, canTest }) => {
  const [settings, setSettings] = useState<OkcSettingsWire | null>(null);
  const [failures, setFailures] = useState<OkcFailure[]>([]);
  const [status, setStatus] = useState<OkcConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setSettings(await invokeIPC<OkcSettingsWire>('get_okc_settings', { actorRole, tenantId }));
      setFailures(await invokeIPC<OkcFailure[]>('list_okc_failures', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (change: Partial<OkcSettingsWire>) => setSettings((current) => (current ? { ...current, ...change } : current));

  const save = async () => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setSettings(await invokeIPC<OkcSettingsWire>('set_okc_settings', { actorRole, tenantId, settings }));
      setStatus(null);
    } catch (caught) {
      // Girilen değerler korunur; yalnız hata gösterilir.
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setStatus(await invokeIPC<OkcConnectionStatus>('test_okc_connection', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const kinds = Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[];
  const isSimulator = settings?.connectionKind === 'SIMULATOR';

  return (
    <section className="work-surface border border-[var(--border)] rounded-xl p-4 space-y-3 max-w-xl">
      <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Yazar Kasa (ÖKC)</h2>
      {failures.length > 0 ? (
        <div className="space-y-2" aria-label="Fişi kesilemeyen tahsilatlar">
          <InlineAlert message={`${failures.length} tahsilatın yazar kasa fişi kesilemedi. Tahsilat tamamlanmadı, adisyon açık kalır.`} />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {failures.map((failure) => (
              <li key={failure.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-words">{failure.errorMessage ?? failure.errorCode ?? 'Bilinmeyen hata'}</span>
                <span className="tabular-nums font-bold">{formatMoney(failure.totalCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {settings === null && !error ? <p role="status" className="text-sm">Ayarlar yükleniyor.</p> : null}
      {settings ? (
        <div className="space-y-3">
          <label className="flex min-h-12 items-center gap-3 text-sm text-[var(--text-primary)] cursor-pointer">
            <input type="checkbox" checked={settings.enabled} disabled={!canEdit} onChange={(event) => patch({ enabled: event.target.checked })} />
            <span>Tahsilatta yazar kasa fişi kes</span>
          </label>
          {!isSimulator ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Bağlantı türü">
              {kinds.map((kind) => (
                <Button key={kind} variant={settings.connectionKind === kind ? 'selected' : 'secondary'} disabled={!canEdit} onClick={() => patch({ connectionKind: kind })}>
                  {KIND_LABEL[kind]}
                </Button>
              ))}
            </div>
          ) : null}
          {!isSimulator ? (
            <label className="block space-y-1 text-sm">
              <span>{PORT_LABEL[settings.connectionKind]}</span>
              <Input value={settings.port} disabled={!canEdit} onChange={(event) => patch({ port: event.target.value })} />
            </label>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span>Terminal seri numarası</span>
            <Input value={settings.terminalSerial} maxLength={12} disabled={!canEdit} onChange={(event) => patch({ terminalSerial: event.target.value.trim() })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span>Baud hızı</span>
              <NumberInput kind="digits" value={settings.baudRate} disabled={!canEdit} onValueChange={(raw) => patch({ baudRate: Number.parseInt(raw || '0', 10) })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Cevap bekleme (ms)</span>
              <NumberInput kind="digits" value={settings.responseTimeoutMs} disabled={!canEdit} onValueChange={(raw) => patch({ responseTimeoutMs: Number.parseInt(raw || '0', 10) })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? <Button variant="primary" disabled={busy} onClick={() => void save()}>Kaydet</Button> : null}
            {canTest ? <Button variant="secondary" disabled={busy} onClick={() => void test()}>Bağlantıyı dene</Button> : null}
          </div>
          {status ? (
            status.connected
              ? <p role="status" className="text-sm font-semibold">{status.message}</p>
              : <InlineAlert message={status.code ? `${status.code}: ${status.message}` : status.message} />
          ) : null}
        </div>
      ) : null}
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
    </section>
  );
};
