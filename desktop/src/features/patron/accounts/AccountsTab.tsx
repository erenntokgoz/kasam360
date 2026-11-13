import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { formatMoney } from '../../../lib/formatMoney';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { Button } from '../../../ui/Button';
import { ErrorToast } from '../../../ui/ErrorToast';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { AccountFormModal } from './AccountFormModal';
import { MoneyFlowList } from './MoneyFlowList';
import { TransferModal } from './TransferModal';
import { KIND_LABEL, type MoneyAccount } from './accountsModel';

type Section = 'ACCOUNTS' | 'FLOW';

const SECTIONS: SectionTab<Section>[] = [
  { id: 'ACCOUNTS', label: 'Hesaplar' },
  { id: 'FLOW', label: 'Nakit Akışı' },
];

/** Kasa, banka ve POS hesapları; hesaplar arası transfer ve nakit giriş-çıkış akışı. */
export const AccountsTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [section, setSection] = useState<Section>('ACCOUNTS');
  const [accounts, setAccounts] = useState<MoneyAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { actorRole, tenantId } = sessionArgs();
      setAccounts(await invokeIPC<MoneyAccount[]>('list_money_accounts', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = () => { void load(); setRevision((value) => value + 1); };

  const setActive = async (account: MoneyAccount, active: boolean) => {
    setError(null);
    try {
      const { actorRole, actorId, tenantId } = sessionArgs();
      await invokeIPC('set_money_account_active', { actorRole, actorId, tenantId, accountId: account.id, active });
      refresh();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const activeAccounts = accounts?.filter((account) => account.isActive) ?? [];
  const total = activeAccounts.reduce((sum, account) => sum + account.balanceCents, 0);

  return (
    <div className="space-y-4">
      <SectionTabs label="Para ve hesaplar bölümleri" tabs={SECTIONS} active={section} onChange={setSection}
        actions={isOwner ? (
          <>
            <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />Hesap Ekle</Button>
            <Button variant="primary" disabled={activeAccounts.length < 2} onClick={() => setTransferring(true)}>
              <ArrowLeftRight size={16} aria-hidden="true" />Transfer
            </Button>
          </>
        ) : undefined} />
      {error ? <ErrorToast message={error} /> : null}

      {section === 'ACCOUNTS' ? (
        <>
          {accounts === null && !error ? <p role="status" className="text-sm">Hesaplar yükleniyor.</p> : null}
          {accounts?.length === 0 ? <p className="text-sm">Tanımlı hesap yok.</p> : null}
          {accounts && accounts.length > 0 ? (
            <div className="work-surface overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left"><th>Hesap</th><th>Tür</th><th className="text-right">Açılış</th><th className="text-right">Bakiye</th><th><span className="sr-only">İşlem</span></th></tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className={account.isActive ? '' : 'opacity-60'}>
                      <td className="font-bold">{account.name}{account.isActive ? '' : ' (pasif)'}</td>
                      <td>{KIND_LABEL[account.kind]}</td>
                      <td className="text-right tabular-nums">{formatMoney(account.openingCents)}</td>
                      <td className="text-right font-bold tabular-nums">{formatMoney(account.balanceCents)}</td>
                      <td className="text-right">
                        {isOwner ? (
                          <Button size="sm" disabled={account.isActive && account.balanceCents !== 0}
                            title={account.isActive && account.balanceCents !== 0 ? 'Bakiyesi olan hesap pasife alınamaz.' : undefined}
                            onClick={() => void setActive(account, !account.isActive)}>
                            {account.isActive ? 'Pasife Al' : 'Etkinleştir'}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td className="font-bold" colSpan={3}>Etkin hesaplar toplamı</td><td className="text-right font-bold tabular-nums">{formatMoney(total)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </>
      ) : <MoneyFlowList key={revision} />}

      {creating ? <AccountFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} /> : null}
      {transferring ? <TransferModal accounts={activeAccounts} onClose={() => setTransferring(false)} onSaved={() => { setTransferring(false); refresh(); }} /> : null}
    </div>
  );
};
