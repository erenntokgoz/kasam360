import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useCariStore } from '../../stores/cariStore';
import { balanceLabel } from '../../lib/cariLedger';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { CariCardModal } from './CariCardModal';
import { CariCardDetail } from './CariCardDetail';
import { CariPendingReceipts } from './CariPendingReceipts';
import type { DirectoryContact } from '../../types/ledger';

type CariTab = 'CUSTOMER' | 'SUPPLIER';

const TABS: Array<{ id: CariTab; label: string }> = [
  { id: 'CUSTOMER', label: 'Müşteriler' },
  { id: 'SUPPLIER', label: 'Tedarikçiler' },
];

function balanceTone(cents: number): string {
  if (cents > 0) return 'text-[var(--accent-emerald)]';
  if (cents < 0) return 'text-[var(--accent-red)]';
  return 'text-[var(--text-muted)]';
}

const CardRow: React.FC<{ card: DirectoryContact; onOpen: () => void }> = ({ card, onOpen }) => (
  <li>
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-12 px-4 py-3 text-left flex items-center justify-between gap-3 cursor-pointer hover:bg-[var(--bg-hover)]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold truncate text-[var(--text-primary)]">{card.name}</span>
        <span className="block text-xs text-[var(--text-muted)] truncate tabular-nums">{card.phone || 'Telefon yok'}</span>
      </span>
      <span className="text-right shrink-0">
        <span className={`block text-sm font-bold tabular-nums ${balanceTone(card.balanceCents)}`}>
          {formatMoney(Math.abs(card.balanceCents))}
        </span>
        <span className="block text-xs text-[var(--text-secondary)]">{balanceLabel(card.balanceCents)}</span>
      </span>
    </button>
  </li>
);

export const DebtsTab: React.FC = () => {
  const { cards, awaiting, loadError, loadCards, loadAwaiting } = useCariStore();
  const [tab, setTab] = useState<CariTab>('CUSTOMER');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const refresh = useCallback(() => loadCards(tab, search), [loadCards, tab, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'SUPPLIER') void loadAwaiting();
  }, [tab, loadAwaiting]);

  const selected = selectedId ? cards.find((card) => card.id === selectedId) ?? null : null;
  // Kartı olmayan tedarikçinin teslimi hiçbir kartta görünmez; listede durur, onayda kart açılır.
  const unlinked = tab === 'SUPPLIER' ? awaiting.filter((document) => !document.directoryId) : [];

  const handleTab = (next: CariTab) => {
    setTab(next);
    setSearch('');
    setSelectedId(null);
  };

  const handleCreated = (card: DirectoryContact) => {
    setIsCreating(false);
    setSearch('');
    setSelectedId(card.id);
    void loadCards(tab, '');
  };

  const errorBox = loadError ? (<>
    <p className="text-sm text-[var(--text-secondary)]">Cari kayıtlar okunamadı.</p>
    <ErrorToast message={loadError} />
  </>) : null;

  if (selected) {
    return (
      <div className="flex flex-col gap-4 h-full min-h-0 overflow-y-auto">
        {errorBox}
        <CariCardDetail
          key={selected.id}
          card={selected}
          onBack={() => setSelectedId(null)}
          onChanged={() => void refresh()}
          onDeleted={() => {
            setSelectedId(null);
            void refresh();
          }}
        />
      </div>
    );
  }

  const createButton = (
    <Button variant="primary" onClick={() => setIsCreating(true)} className="min-h-12">
      <Plus className="w-4 h-4" />
      <span>Yeni Kart</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Cari türü">
          {TABS.map((item) => (
            <Button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              variant={tab === item.id ? 'selected' : 'secondary'}
              onClick={() => handleTab(item.id)}
              className="min-h-12"
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Cari ara"
            className="!pl-9 min-h-12"
          />
        </div>
      </div>

      {errorBox}

      <CariPendingReceipts
        documents={unlinked}
        showSupplier
        onDone={() => {
          void loadAwaiting();
          void refresh();
        }}
      />

      <section className="paper border border-[var(--border)] rounded-xl overflow-hidden flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-[var(--text-primary)] tabular-nums">
            {tab === 'SUPPLIER' ? 'Tedarikçi Kartları' : 'Müşteri Kartları'} · {cards.length}
          </h4>
          {cards.length > 0 || search.trim() ? createButton : null}
        </div>
        {cards.length === 0 ? (
          <div className="p-8 flex flex-col items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>{search.trim() ? 'Eşleşen kart yok.' : 'Henüz kart yok.'}</span>
            {search.trim() ? null : createButton}
          </div>
        ) : (
          <ul className="overflow-y-auto divide-y divide-[var(--border)]">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} onOpen={() => setSelectedId(card.id)} />
            ))}
          </ul>
        )}
      </section>

      <CariCardModal
        isOpen={isCreating}
        directoryType={tab}
        onClose={() => setIsCreating(false)}
        onCreated={handleCreated}
      />
    </div>
  );
};
