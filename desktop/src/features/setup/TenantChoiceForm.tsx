import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { Button } from '../../ui/Button';
import { restoreTenant, type CloudTenant } from './cloudRestore';

interface TenantChoiceFormProps {
  email: string;
  tenants: CloudTenant[];
  /** Bulutta kasa verisi olmayan işletme seçildi: kurulum bu işletme adına sürer. */
  onSetupForTenant: (tenant: CloudTenant) => Promise<void>;
  onNewBusiness: () => Promise<void>;
  onBack: () => void;
}

/**
 * Hesabın mevcut işletmesine bu kasayı bağlar. Hata kalıcı metinle gösterilir ve seçim korunur;
 * yeni işletme kurmak ayrı ve açık bir seçimdir, hata sonrası kendiliğinden yapılmaz.
 */
export const TenantChoiceForm: React.FC<TenantChoiceFormProps> = ({ email, tenants, onSetupForTenant, onNewBusiness, onBack }) => {
  const [selected, setSelected] = useState(tenants[0]?.tenantId ?? '');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const tenant = tenants.find((item) => item.tenantId === selected);
    if (!tenant || busy) return;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      if (!(await restoreTenant(tenant.tenantId, email, setRows))) await onSetupForTenant(tenant);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="text-sm font-semibold mb-1">Bu kasayı bağlayacağın işletme</legend>
        {tenants.map((tenant) => (
          <label key={tenant.tenantId}
            className="flex min-h-12 items-center gap-3 rounded-md border border-[var(--border)] px-3 cursor-pointer">
            <input type="radio" name="tenant" value={tenant.tenantId} checked={selected === tenant.tenantId}
              onChange={() => setSelected(tenant.tenantId)} />
            <span className="font-medium">{tenant.name}</span>
          </label>
        ))}
      </fieldset>
      {rows !== null ? <p role="status" className="text-sm tabular-nums">İndirilen kayıt: {rows}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}
      <Button type="button" variant="primary" className="w-full min-h-12" isLoading={busy} disabled={!selected} onClick={() => void connect()}>
        {error ? 'Tekrar Dene' : 'Bu İşletmeye Bağlan'}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" className="min-h-12" disabled={busy} onClick={onBack}>Geri</Button>
        <Button type="button" variant="secondary" className="min-h-12" disabled={busy}
          onClick={() => void onNewBusiness().catch((caught) => setError(errorText(caught)))}>
          Yeni İşletme Kur
        </Button>
      </div>
    </div>
  );
};
