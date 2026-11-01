import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useCariStore } from '../../stores/cariStore';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { CariCardModal } from './CariCardModal';
import { CariCardDetail } from './CariCardDetail';
import { SupplierDocumentsPanel } from './SupplierDocumentsPanel';
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

export const DebtsTab: React.FC = () => {
  const { cards, loadError, loadCards } = useCariStore();
  const [tab, setTab] = useState<CariTab>('CUSTOMER');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const refresh = useCallback(() => loadCards(tab, search), [loadCards, tab, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sağ taraf boş bir kutu olarak kalmasın: seçim yoksa ilk kart açık gelir.
  const selected = cards.find((card) => card.id === selectedId) ?? cards[0] ?? null;

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

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-6 mr-4" role="tablist" aria-label="Cari türü">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => handleTab(item.id)}
              className="desk-tab text-lg"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad veya telefon ara"
            aria-label="Cari ara"
            className="pl-9 min-h-12"
          />
        </div>
        <Button variant="primary" onClick={() => setIsCreating(true)} className="min-h-12">
          <Plus className="w-4 h-4" />
          <span>Yeni Kart</span>
        </Button>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="p-3 rounded-lg bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red)] text-xs font-semibold"
        >
          {loadError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        <ul className="paper overflow-y-auto divide-y divide-[var(--border)]">
          {cards.length === 0 ? (
            <li className="p-6 text-center text-xs text-[var(--text-muted)]">
              {search.trim() ? 'Aramayla eşleşen kart yok.' : 'Henüz kart yok.'}
            </li>
          ) : (
            cards.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(card.id)}
                  aria-current={card.id === selected?.id}
                  className={`w-full min-h-12 p-3 text-left flex items-center justify-between gap-3 cursor-pointer ${
                    card.id === selected?.id ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-bold truncate text-[var(--text-primary)]">
                      {card.name}
                    </span>
                    <span className="block text-xs text-[var(--text-muted)] truncate">
                      {card.phone || 'Telefon yok'}
                    </span>
                  </span>
                  <span className={`font-bold tabular-nums shrink-0 ${balanceTone(card.balanceCents)}`}>
                    {formatMoney(card.balanceCents)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="min-w-0 space-y-4 overflow-y-auto">
          {tab === 'SUPPLIER' ? <SupplierDocumentsPanel onChanged={refresh} /> : null}
          {selected ? (
            <CariCardDetail key={selected.id} card={selected} onChanged={refresh} />
          ) : (
            <div className="paper p-6 text-[var(--text-secondary)]">
              {search.trim() ? 'Aramayla eşleşen kart yok.' : 'Henüz kart yok. Yeni Kart ile başlayın.'}
            </div>
          )}
        </div>
      </div>

      <CariCardModal
        isOpen={isCreating}
        directoryType={tab}
        onClose={() => setIsCreating(false)}
        onCreated={handleCreated}
      />
    </div>
  );
};
