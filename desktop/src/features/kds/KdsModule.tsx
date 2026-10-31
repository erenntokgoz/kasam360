import React, { useEffect } from 'react';
import { Volume2, VolumeX, RotateCcw, Check, Clock } from 'lucide-react';
import { useKdsStore } from '../../stores/kdsStore';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import type { KdsTicketItem } from '../../types/kds';

export const KdsModule: React.FC = () => {
  const {
    tickets,
    selectedStation,
    soundEnabled,
    loadTickets,
    setSelectedStation,
    toggleItemStatus,
    completeTicket,
    recallLastTicket,
    toggleSound,
    playOrderBell,
  } = useKdsStore();

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const filteredTickets = tickets.filter((t) => {
    if (selectedStation === 'TUMU') return !t.isCompleted;
    return t.station === selectedStation && !t.isCompleted;
  });

  const getStatusBadge = (status: KdsTicketItem['status']) => {
    switch (status) {
      case 'READY':
        return <Badge variant="emerald">Hazır</Badge>;
      case 'PREPARING':
        return <Badge variant="amber">Hazırlanıyor</Badge>;
      case 'SERVED':
        return <Badge variant="blue">Teslim</Badge>;
      default:
        return <Badge variant="neutral">Bekliyor</Badge>;
    }
  };

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] select-none">
      {/* Üst Operasyon Barı */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          {[
            { id: 'TUMU' as const, label: 'Tüm İstasyonlar' },
            { id: 'MUTFAK' as const, label: 'Mutfak' },
            { id: 'BAR' as const, label: 'Bar' },
            { id: 'TATLI' as const, label: 'Tatlı' },
          ].map((st) => {
            const count = tickets.filter((t) =>
              st.id === 'TUMU' ? !t.isCompleted : t.station === st.id && !t.isCompleted
            ).length;
            const isSelected = selectedStation === st.id;
            return (
              <Button
                key={st.id}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelectedStation(st.id)}
                className="!min-h-12 tabular-nums text-xs"
              >
                {st.label} ({count})
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={recallLastTicket}
            className="!min-h-12 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            <span>Son Fişi Geri Çağır</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={toggleSound}
            className="!min-h-12 text-xs"
            title={soundEnabled ? 'Sesi Kapat' : 'Sesi Aç'}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-[var(--accent-amber)]" />
            ) : (
              <VolumeX className="w-4 h-4 text-[var(--text-muted)]" />
            )}
            <span className="hidden sm:inline">Ses</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={playOrderBell}
            className="!min-h-12 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Zil Testi"
          >
            Test
          </Button>
        </div>
      </div>

      {/* Biletler Izgarası */}
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
        {filteredTickets.length === 0 ? (
          <div className="col-span-full py-16 text-center text-xs text-[var(--text-muted)]">
            Hazırlanması bekleyen açık sipariş fişi bulunmuyor.
          </div>
        ) : (
          filteredTickets.map((ticket) => {
            const isUrgent = ticket.elapsedMinutes >= 15;

            return (
              <div
                key={ticket.id}
                className={`paper slip-edge rounded-xl border flex flex-col justify-between shadow-md overflow-hidden ${
                  isUrgent ? 'slip-pink' : 'slip-yellow'
                }`}
              >
                {/* Bilet Başlığı */}
                <div
                  className={`p-3.5 border-b flex items-center justify-between ${
                    isUrgent
                      ? 'border-[var(--accent-red-border)]'
                      : 'border-[var(--accent-amber-border)]'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-[var(--text-primary)]">
                        {ticket.tableName}
                      </span>
                      <span className="text-xs font-mono font-bold text-[var(--accent-amber)]">
                        #{ticket.ticketNumber}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                      Garson: {ticket.waiterName || 'Servis'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
                    <Clock
                      className={`w-4 h-4 ${
                        isUrgent ? 'text-[var(--accent-red)] animate-pulse' : 'text-[var(--text-secondary)]'
                      }`}
                    />
                    <span className={isUrgent ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}>
                      {ticket.elapsedMinutes} dk
                    </span>
                  </div>
                </div>

                {/* Kalemler */}
                <div className="p-3.5 divide-y divide-[var(--border)] space-y-2 flex-1">
                  {ticket.items.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => toggleItemStatus(ticket.id, item.id)}
                      className="pt-2 first:pt-0 flex items-start justify-between gap-2 cursor-pointer group"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center font-bold text-sm text-[var(--accent-amber)] tabular-nums shrink-0">
                          {item.quantity}
                        </span>
                        <div>
                          <span
                            className={`text-sm font-bold block ${
                              item.status === 'READY' || item.status === 'SERVED'
                                ? 'line-through text-[var(--text-muted)]'
                                : 'hand'
                            }`}
                          >
                            {item.productName}
                          </span>
                          {item.cookingDegree ? (
                            <span className="text-xs font-semibold text-[var(--accent-amber)] block">
                              {item.cookingDegree}
                            </span>
                          ) : null}
                          {item.notes ? (
                            <span className="text-xs text-[var(--text-secondary)] italic block">
                              Not: {item.notes}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mt-0.5">
                            {item.course}. Kurs
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0">{getStatusBadge(item.status)}</div>
                    </div>
                  ))}
                </div>

                {/* Bilet Altı */}
                <div className="p-3 border-t border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--text-muted)]">Kaleme dokunup durumu güncelleyin</span>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => completeTicket(ticket.id)}
                    className="!min-h-12 text-xs font-bold"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    <span>Fişi Tamamla</span>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
