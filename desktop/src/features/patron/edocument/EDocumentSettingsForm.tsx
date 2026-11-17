import React, { useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { Input } from '../../../ui/Input';
import { settingsProblem, type EDocumentSettings } from './eDocumentModel';

interface Props {
  canEdit: boolean;
  onSaved: () => void;
}

const FIELDS: { key: keyof Omit<EDocumentSettings, 'enabled'>; label: string; max: number }[] = [
  { key: 'taxId', label: 'VKN / TCKN', max: 11 },
  { key: 'legalName', label: 'Unvan', max: 120 },
  { key: 'taxOffice', label: 'Vergi dairesi', max: 80 },
  { key: 'seriesCode', label: 'Birim kodu (3 karakter)', max: 3 },
  { key: 'street', label: 'Adres', max: 200 },
  { key: 'district', label: 'İlçe', max: 80 },
  { key: 'city', label: 'Şehir', max: 80 },
];

/** Belgeyi düzenleyen işletmenin kimliği. Yalnız işletme sahibi değiştirir; hata sonrası girilenler korunur. */
export const EDocumentSettingsForm: React.FC<Props> = ({ canEdit, onSaved }) => {
  const [form, setForm] = useState<EDocumentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { actorRole, tenantId } = sessionArgs();
        setForm(await invokeIPC<EDocumentSettings>('get_e_document_settings', { actorRole, tenantId }));
      } catch (caught) {
        setError(errorText(caught));
      }
    })();
  }, []);

  if (!form) {
    return error ? <InlineAlert message={error} /> : <p role="status" className="text-sm">Ayarlar yükleniyor.</p>;
  }

  const problem = settingsProblem(form);
  const change = (patch: Partial<EDocumentSettings>) => { setSaved(false); setForm({ ...form, ...patch }); };

  const save = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      setForm(await invokeIPC<EDocumentSettings>('save_e_document_settings', { actorRole, actorId, tenantId, settings: form }));
      setSaved(true);
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="max-w-xl space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={!canEdit || busy} className="space-y-3">
        <label className="flex min-h-12 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="size-5" checked={form.enabled}
            onChange={(event) => change({ enabled: event.target.checked })} />
          e-Adisyon açık
        </label>
        {FIELDS.map((field) => (
          <label key={field.key} className="block space-y-1">
            <span className="text-sm font-semibold">{field.label}</span>
            <Input maxLength={field.max} value={form[field.key]} onChange={(event) => change({ [field.key]: event.target.value } as Partial<EDocumentSettings>)} />
          </label>
        ))}
      </fieldset>
      {problem ? <InlineAlert message={problem} /> : null}
      {error ? <InlineAlert message={error} onDismiss={() => setError(null)} /> : null}
      {saved ? <p role="status" className="text-sm font-semibold">Ayarlar kaydedildi.</p> : null}
      {canEdit ? (
        <div className="border-t border-[var(--border)] pt-3">
          <Button type="submit" variant="primary" disabled={problem !== null} isLoading={busy}>Ayarları Kaydet</Button>
        </div>
      ) : <p className="text-sm">Ayarları yalnız işletme sahibi değiştirir.</p>}
    </form>
  );
};
