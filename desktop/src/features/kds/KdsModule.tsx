import React, { useCallback, useEffect, useState } from 'react';
import { Volume2, VolumeX, Check, Clock, Flame, Send } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatNumber } from '../../lib/numberText';
import { ticketStage, useKdsStore, type KdsTicketStage } from '../../stores/kdsStore';
import { useUIStore } from '../../stores/uiStore';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { Button } from '../../ui/Button';
import { InlineAlert } from '../../ui/InlineAlert';
import { Badge } from '../../ui/Badge';
import type { KdsTicket, KdsTicketItem } from '../../types/kds';
import { useAuthStore } from '../../stores/authStore';
import { canAdvanceKitchen } from '../../lib/roleAccess';
import { stationKey, useStationStore } from '../../stores/stationStore';

const REFRESH_MS = 5_000;
const URGENT_MINUTES = 15;
const WARN_MINUTES = 10;

const STAGE_ACTION: Record<KdsTicketStage, { label: string; icon: typeof Flame; variant: 'primary' | 'success' }> = {
  PENDING: { label: 'Hazırlamaya Başla', icon: Flame, variant: 'primary' },
  PREPARING: { label: 'Hepsi Hazır', icon: Check, variant: 'primary' },
  READY: { label: 'Teslim Edildi', icon: Send, variant: 'success' },
};

const StatusBadge: React.FC<{ status: KdsTicketItem['status'] }> = ({ status }) => {
  if (status === 'CANCELLED') return <Badge variant="red">İptal</Badge>;
  if (status === 'READY') return <Badge variant="emerald">Hazır</Badge>;
  if (status === 'PREPARING') return <Badge variant="amber">Hazırlanıyor</Badge>;
  return <Badge variant="neutral">Bekliyor</Badge>;
};

const TicketCard: React.FC<{
  ticket: KdsTicket;
  onToggleItem?: (itemId: string) => void;
  onAdvance?: () => Promise<void>;
}> = ({ ticket, onToggleItem, onAdvance }) => {
  // Üç aşama aynı düğmede ilerler; çift dokunuş bir aşamayı atlamasın diye düğme
  // işlem bitip yeni aşama ekrana gelene kadar kilitli kalır.
  const [isAdvancing, setIsAdvancing] = useState(false);
  const handleAdvance = () => {
    if (isAdvancing || !onAdvance) return;
    setIsAdvancing(true);
    void onAdvance().finally(() => window.setTimeout(() => setIsAdvancing(false), 600));
  };
  const isUrgent = ticket.elapsedMinutes >= URGENT_MINUTES;
  const isWarn = !isUrgent && ticket.elapsedMinutes >= WARN_MINUTES;
  const action = STAGE_ACTION[ticketStage(ticket)];
  const ActionIcon = action.icon;

  return (
    <article
      data-urgency={isUrgent ? 'urgent' : isWarn ? 'warn' : 'normal'}
      className={`motion-item bg-[var(--bg-card)] rounded-lg border flex flex-col overflow-hidden ${
        isUrgent ? 'border-[var(--accent-red)] shadow-[inset_0_4px_0_var(--accent-red)]' : isWarn ? 'border-[var(--accent-amber)] shadow-[inset_0_4px_0_var(--accent-amber)]' : 'border-[var(--border-strong)] shadow-[inset_0_4px_0_var(--border-strong)]'
      }`}
    >
      <header className="px-4 pt-4 pb-3 border-b border-[var(--border)] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-2xl font-extrabold text-[var(--text-primary)] truncate">{ticket.tableName}</h3>
          <p className="text-sm text-[var(--text-secondary)] truncate">
            <span className="tabular-nums">#{ticket.ticketNumber}</span>
            {ticket.waiterName ? ` · ${ticket.waiterName}` : ''}
          </p>
        </div>
        <span className={`flex items-center gap-1.5 text-xl font-extrabold tabular-nums shrink-0 ${isUrgent ? 'text-[var(--accent-red)]' : isWarn ? 'text-[var(--accent-amber)]' : 'text-[var(--text-secondary)]'}`}>
          <Clock className="w-5 h-5" />
          {formatNumber(ticket.elapsedMinutes)} dk
        </span>
      </header>

      <div className="px-4 py-1 divide-y divide-[var(--border)] flex-1">
        {ticket.items.map((item) => (
          <button
            type="button"
            key={item.id}
            disabled={!onToggleItem}
            onClick={() => onToggleItem?.(item.id)}
            className="w-full min-h-14 py-2 text-left flex items-start justify-between gap-2 enabled:cursor-pointer"
          >
            <span className="flex items-start gap-2 min-w-0">
              <span className="w-10 h-10 rounded-lg bg-[var(--bg-subtle)] flex items-center justify-center font-extrabold text-xl tabular-nums shrink-0">
                {formatNumber(item.quantity)}
              </span>
              <span className="min-w-0">
                <span className={`block text-lg font-bold ${item.status === 'READY' || item.status === 'CANCELLED' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
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

      {onAdvance ? <div className="p-3 border-t border-[var(--border)]">
        <Button variant={action.variant} className="w-full" disabled={isAdvancing} onClick={handleAdvance}>
          <ActionIcon className="w-5 h-5" />
          <span>{action.label}</span>
        </Button>
      </div> : null}
    </article>
  );
};

/** Fişler kendiliğinden tazelenir: mutfak ekranına kimse dokunmadan yeni sipariş düşer. */
export const KdsModule: React.FC = () => {
  const { stations, load: loadStations } = useStationStore();
  const userId = useAuthStore((state) => state.user?.userId);
  const readOnly = useAuthStore((state) => !canAdvanceKitchen(state.user?.role));
  useEffect(() => {
    void loadStations().catch(() => undefined);
  }, [loadStations]);
  const { tickets, hasLoaded, selectedStation, soundEnabled, loadTickets, setSelectedStation, toggleItemStatus, advanceTicket, toggleSound } = useKdsStore();
  const isOpen = useUIStore((state) => state.activeModule === 'KDS');
  const [error, setError] = useState<string | null>(null);

  const guarded = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (caught) {
      // Kilit sırasında düşen hata kilit açılınca ekranda kalmasın.
      if (!/SESSION_LOCKED/.test(String(caught))) setError(errorText(caught));
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

  // Görevli atanan kullanıcı yalnız kendi istasyonunu görür; atanmamışsa hepsini görür.
  const own = stations.filter((station) => userId && station.userIds.includes(userId));
  // İstasyon tanımlanmamışsa eski kategorilerin istasyonu yine sekme olarak görünür.
  const tabs = own.length > 0 ? own : stations.length > 0 ? stations : [...new Set(tickets.map((ticket) => ticket.station))].map((name) => ({ id: name, name, printerName: null, userIds: [] }));
  const allowed = own.length > 0 ? tickets.filter((ticket) => own.some((station) => stationKey(station.name) === ticket.station)) : tickets;
  // En uzun bekleyen fiş başa gelir: mutfak sırayı ekrandan okur.
  const visible = allowed
    .filter((ticket) => selectedStation === 'TUMU' || ticket.station === selectedStation)
    .sort((left, right) => right.elapsedMinutes - left.elapsedMinutes);

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
        {[{ id: 'TUMU', label: 'Tümü' }, ...tabs.map((station) => ({ id: stationKey(station.name), label: station.name }))].map((station) => {
          const count = allowed.filter((ticket) => station.id === 'TUMU' || ticket.station === station.id).length;
          return (
            <BarTab key={station.id} active={selectedStation === station.id} onClick={() => setSelectedStation(station.id)}>
              {station.label}
              <span className="tabular-nums text-[var(--text-muted)]">{formatNumber(count)}</span>
            </BarTab>
          );
        })}
      </Bar>

      {error ? (
        <div className="p-4 pb-0 flex flex-wrap items-center gap-3">
          <InlineAlert message={error} className="flex-1 min-w-64" />
          <Button variant="secondary" size="lg" onClick={() => void guarded(loadTickets)}>Yeniden dene</Button>
        </div>
      ) : null}

      <div aria-busy={!hasLoaded} className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start content-start">
        {visible.length === 0 ? (
          // Okunamayan liste boş sayılmaz: "fiş yok" yalnız başarılı okumadan sonra söylenir.
          <p className="col-span-full py-20 text-center text-lg text-[var(--text-muted)]">
            {error ? 'Fişler okunamadı.' : hasLoaded ? 'Bekleyen fiş yok.' : 'Fişler okunuyor.'}
          </p>
        ) : (
          visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onToggleItem={readOnly ? undefined : (itemId) => void guarded(() => toggleItemStatus(ticket.id, itemId))}
              onAdvance={readOnly ? undefined : () => guarded(() => advanceTicket(ticket.id))}
            />
          ))
        )}
      </div>
    </section>
  );
};
