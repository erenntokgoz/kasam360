import React, { useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { parseCents } from '../../../lib/moneyInput';
import { createPrefixedId } from '../../../lib/prefixedId';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { useUIStore } from '../../../stores/uiStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { NumberInput } from '../../../ui/NumberInput';
import { KIND_LABEL, transferProblem, type MoneyAccount } from './accountsModel';

const selectClass = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm';

/** İki etkin hesap arasında transfer; kimlik formla birlikte üretilir, belirsiz bir hatadan sonra yeniden denemek çift kayıt açmaz. */
export const TransferModal: React.FC<{ accounts: MoneyAccount[]; onClose: () => void; onSaved: () => void }> = ({ accounts, onClose, onSaved }) => {
  const [transferId] = useState(() => createPrefixedId('xfr'));
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = accounts.find((account) => account.id === fromId);
  const to = accounts.find((account) => account.id === toId);
  const cents = parseCents(amount);
  const problem = transferProblem(from, to, cents);

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC('transfer_between_accounts', {
        actorRole, actorId, tenantId, transferId, fromAccountId: fromId, toAccountId: toId, amountCents: cents, note: note.trim(),
      });
      useUIStore.getState().showNotice('Transfer kaydedildi.');
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const option = (account: MoneyAccount) => (
    <option key={account.id} value={account.id}>{account.name} ({KIND_LABEL[account.kind]}) · {formatMoney(account.balanceCents)}</option>
  );

  return (
    <Modal cardFlow isOpen title="Hesaplar Arası Transfer" maxWidth="sm" onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block space-y-1"><span className="text-sm font-semibold">Kaynak hesap</span>
            <select className={selectClass} value={fromId} onChange={(event) => setFromId(event.target.value)}>{accounts.map(option)}</select>
          </label>
          <label className="block space-y-1"><span className="text-sm font-semibold">Hedef hesap</span>
            <select className={selectClass} value={toId} onChange={(event) => setToId(event.target.value)}>{accounts.map(option)}</select>
          </label>
          <label className="block space-y-1"><span className="text-sm font-semibold">Tutar</span>
            <NumberInput aria-label="Transfer tutarı" className="tabular-nums" value={amount} onValueChange={setAmount} />
          </label>
          <label className="block space-y-1"><span className="text-sm font-semibold">Açıklama</span>
            <Input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </fieldset>
        {amount !== '' && problem ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{problem}</p> : null}
        {error ? <ErrorToast message={error} /> : null}
        <div className="flex justify-between gap-2 border-t border-[var(--border)] pt-3">
          <Button type="button" disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={problem !== null} isLoading={busy}>Transfer Et</Button>
        </div>
      </form>
    </Modal>
  );
};
