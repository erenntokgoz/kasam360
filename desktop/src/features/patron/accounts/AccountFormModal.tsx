import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { parseCents } from '../../../lib/moneyInput';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { NumberInput } from '../../../ui/NumberInput';
import { KIND_LABEL, type AccountKind } from './accountsModel';

/** Yeni para hesabı; açılış tutarı o güne kadar hesapta olan paradır. */
export const AccountFormModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('CASH');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingCents = opening.trim() === '' ? 0 : parseCents(opening);
  const canSave = name.trim() !== '' && openingCents !== null;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC('create_money_account', { actorRole, actorId, tenantId, name: name.trim(), kind, openingCents });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal cardFlow isOpen title="Hesap Ekle" maxWidth="sm" onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block space-y-1"><span className="text-sm font-semibold">Hesap adı</span>
            <Input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block space-y-1"><span className="text-sm font-semibold">Tür</span>
            <select className="min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm" value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
              {(Object.keys(KIND_LABEL) as AccountKind[]).map((id) => <option key={id} value={id}>{KIND_LABEL[id]}</option>)}
            </select>
          </label>
          <label className="block space-y-1"><span className="text-sm font-semibold">Açılış bakiyesi</span>
            <NumberInput aria-label="Açılış bakiyesi" className="tabular-nums" value={opening} onValueChange={setOpening} />
          </label>
        </fieldset>
        {error ? <ErrorToast message={error} /> : null}
        <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={!canSave} isLoading={busy}>Hesabı Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
};
