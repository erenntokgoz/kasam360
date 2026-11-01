import React, { useCallback, useEffect, useState } from 'react';
import { Volume2, VolumeX, Check, Clock, Flame, Send } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatNumber } from '../../lib/numberText';
import { ticketStage, useKdsStore, type KdsTicketStage } from '../../stores/kdsStore';
import { useUIStore } from '../../stores/uiStore';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import type { KdsTicket, KdsTicketItem } from '../../types/kds';

const REFRESH_MS = 5_000;
const URGENT_MINUTES = 15;

const STATIONS = [
  { id: 'TUMU' as const, label: 'Tümü' },
  { id: 'MUTFAK' as const, label: 'Mutfak' },
  { id: 'BAR' as const, label: 'Bar' },
  { id: 'TATLI' as const, label: 'Tatlı' },
];

const STAGE_ACTION: Record<KdsTicketStage, { label: string; icon: typeof Flame; variant: 'primary' | 'success' }> = {
  PENDING: { label: 'Hazırlamaya Başla', icon: Flame, variant: 'primary' },
  PREPARING: { label: 'Hepsi Hazır', icon: Check, variant: 'primary' },
  READY: { label: 'Teslim Edildi', icon: Send, variant: 'success' },
};

const StatusBadge: React.FC<{ status: KdsTicketItem['status'] }> = ({ status }) => {
  if (status === 'READY') return <Badge variant="emerald">Hazır</Badge>;
  if (status === 'PREPARING') return <Badge variant="amber">Hazırlanıyor</Badge>;
  return <Badge variant="neutral">Bekliyor</Badge>;
};

const TicketCard: React.FC<{
  ticket: KdsTicket;
  onToggleItem: (itemId: string) => void;
  onAdvance: () => void;
}> = ({ ticket, onToggleItem, onAdvance }) => {
  const isUrgent = ticket.elapsedMinutes >= URGENT_MINUTES;
  const action = STAGE_ACTION[ticketStage(ticket)];
  const ActionIcon = action.icon;

  return (
    <article className={`paper ${isUrgent ? 'slip-pink' : 'slip-yellow'} rounded-xl border pt-2 flex flex-col`}>
      <header className="px-4 py-3 border-b border-[var(--border-strong)] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xl font-extrabold text-[var(--text-primary)] truncate">{ticket.tableName}</h3>
          <p className="text-sm text-[var(--text-secondary)] truncate">
            <span className="tabular-nums">#{ticket.ticketNumber}</span>
            {ticket.waiterName ? ` · ${ticket.waiterName}` : ''}
          </p>
        </div>
        <span className={`flex items-center gap-1.5 text-base font-bold tabular-nums shrink-0 ${isUrgent ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
          <Clock className="w-4 h-4" />
          {formatNumber(ticket.elapsedMinutes)} dk
        </span>
      </header>

      <div className="px-4 py-1 divide-y divide-[var(--border)] flex-1">
        {ticket.items.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onToggleItem(item.id)}
            className="w-full min-h-12 py-2 text-left flex items-start justify-between gap-2 cursor-pointer"
          >
            <span className="flex items-start gap-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-[var(--bg-card)] flex items-center justify-center font-extrabold text-base tabular-nums shrink-0">
                {formatNumber(item.quantity)}
              </span>
              <span className="min-w-0">
                <span className={`block text-base font-bold ${item.status === 'READY' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                  {item.productName}
                </span>
                {item.modifiers.length > 0 ? (
                  <span className="block text-sm font-semibold text-[var(--text-secondary)]">{item.modifiers.join(', ')}</span>
                ) : null}
                {item.notes ? <span className="block text-sm font-semibold text-[var(--accent-red)]">{item.notes}</span> : null}
              </span>
            </span>
            <span className="shrink-0"><StatusBadge status={item.status} /></span>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-[var(--border)]">
        <Button variant={action.variant} className="w-full" onClick={onAdvance}>
          <ActionIcon className="w-5 h-5" />
          <span>{action.label}</span>
        </Button>
      </div>
    </article>
  );
};

/** Fişler kendiliğinden tazelenir: mutfak ekranına kimse dokunmadan yeni sipariş düşer. */
export const KdsModule: React.FC = () => {
  const { tickets, selectedStation, soundEnabled, loadTickets, setSelectedStation, toggleItemStatus, advanceTicket, toggleSound } = useKdsStore();
  const isOpen = useUIStore((state) => state.activeModule === 'KDS');
  const [error, setError] = useState<string | null>(null);

  const guarded = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    void guarded(loadTickets);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void guarded(loadTickets);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [isOpen, guarded, loadTickets]);

  const visible = tickets.filter((ticket) => selectedStation === 'TUMU' || ticket.station === selectedStation);

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      <Bar
        label="İstasyonlar"
        actions={
          <BarAction onClick={toggleSound} aria-label={soundEnabled ? 'Sesi Kapat' : 'Sesi Aç'}>
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </BarAction>
        }
      >
        {STATIONS.map((station) => {
          const count = tickets.filter((ticket) => station.id === 'TUMU' || ticket.station === station.id).length;
          return (
            <BarTab key={station.id} active={selectedStation === station.id} onClick={() => setSelectedStation(station.id)}>
              {station.label}
              <span className="tabular-nums text-[var(--text-muted)]">{formatNumber(count)}</span>
            </BarTab>
          );
        })}
      </Bar>

      {error ? (
        <p role="alert" className="mx-6 mt-5 p-4 rounded-lg text-sm font-semibold bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          {error}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start content-start">
        {visible.length === 0 ? (
          <p className="col-span-full py-20 text-center text-lg text-[var(--text-muted)]">Bekleyen fiş yok.</p>
        ) : (
          visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onToggleItem={(itemId) => void guarded(() => toggleItemStatus(ticket.id, itemId))}
              onAdvance={() => void guarded(() => advanceTicket(ticket.id))}
            />
          ))
        )}
      </div>
    </section>
  );
};
