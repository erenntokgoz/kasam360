import React, { useEffect } from 'react';
import { Volume2, VolumeX, RotateCcw, Check } from 'lucide-react';
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
      <div className="px-5 pt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 shrink-0 border-b-2 border-[var(--border)]">
        <div className="flex items-center gap-6 overflow-x-auto" role="group" aria-label="İstasyon">
          {[
            { id: 'TUMU' as const, label: 'Tümü' },
            { id: 'MUTFAK' as const, label: 'Mutfak' },
            { id: 'BAR' as const, label: 'Bar' },
            { id: 'TATLI' as const, label: 'Tatlı' },
          ].map((st) => {
            const count = tickets.filter((t) =>
              st.id === 'TUMU' ? !t.isCompleted : t.station === st.id && !t.isCompleted
            ).length;
            return (
              <button
                key={st.id}
                type="button"
                className="desk-tab text-lg tabular-nums"
                aria-pressed={selectedStation === st.id}
                onClick={() => setSelectedStation(st.id)}
              >
                {st.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Button variant="ghost" size="sm" onClick={recallLastTicket}>
            <RotateCcw className="w-4 h-4" />
            <span>Son Fişi Geri Al</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleSound} aria-pressed={soundEnabled}>
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span>{soundEnabled ? 'Ses Açık' : 'Ses Kapalı'}</span>
          </Button>
        </div>
      </div>

      {/* Sipariş yaprakları: geciken yaprak pembeye döner. */}
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-4 gap-y-6 content-start">
        {filteredTickets.length === 0 ? (
          <p className="col-span-full py-16 text-center text-lg text-[var(--text-secondary)]">
            Hazırlanacak sipariş yok.
          </p>
        ) : (
          filteredTickets.map((ticket) => {
            const isUrgent = ticket.elapsedMinutes >= 15;
            return (
              <article key={ticket.id} className={`slip ${isUrgent ? 'slip-pink' : 'slip-yellow'} rounded-t-md px-4 pb-4 flex flex-col gap-2`}>
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="print-title text-2xl truncate">{ticket.tableName}</h3>
                  <span className="font-bold tabular-nums text-[var(--serial)] shrink-0">
                    {ticket.elapsedMinutes} dk
                  </span>
                </header>
                <p className="text-sm font-semibold">
                  {ticket.waiterName || 'Servis'} · Fiş {ticket.ticketNumber}
                </p>
                <div className="flex-1">
                  {ticket.items.map((item) => {
                    const isDone = item.status === 'READY' || item.status === 'SERVED';
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleItemStatus(ticket.id, item.id)}
                        className="w-full min-h-12 py-1.5 flex items-start justify-between gap-2 text-left cursor-pointer border-b border-black/20"
                      >
                        <span className="min-w-0">
                          <span className={`hand block text-2xl leading-tight ${isDone ? 'line-through opacity-60' : ''}`}>
                            {item.quantity} × {item.productName}
                          </span>
                          {item.cookingDegree ? <span className="block text-sm font-bold">{item.cookingDegree}</span> : null}
                          {item.notes ? <span className="block text-sm">Not: {item.notes}</span> : null}
                          <span className="block text-sm">{item.course}. servis</span>
                        </span>
                        <span className="shrink-0">{getStatusBadge(item.status)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="paper !bg-transparent">
                  <Button variant="primary" className="w-full" onClick={() => completeTicket(ticket.id)}>
                    <Check className="w-4 h-4" />
                    <span>Fişi Tamamla</span>
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
