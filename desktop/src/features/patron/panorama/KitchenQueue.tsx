import React from 'react';
import { useKdsStore } from '../../../stores/kdsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { PanoramaData } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

const VISIBLE = 3;

/** Rozet masa numarasını taşır; numara yoksa adın ilk harfleri görünür. */
const tableTag = (name: string) => name.match(/\d+/)?.[0].slice(0, 3) ?? name.slice(0, 2);

/**
 * Mutfak kuyruğu: bekleyen kalem sayısı panodan, bilet satırları mutfak ekranının
 * açık biletlerinden gelir. Mutfak özelliği kapalıysa bilet olmaz; sayı yine görünür.
 */
export const KitchenQueue: React.FC<{ live: PanoramaData['live'] }> = ({ live }) => {
  const tickets = useKdsStore((state) => state.tickets);
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const shown = tickets.slice(0, VISIBLE);
  return (
    <Panel
      title="Mutfak Kuyruğu"
      subtitle={`${live.kitchenWaiting} kalem bekliyor`}
      aside={tickets.length > 0 ? (
        <button type="button" className="card-link" onClick={() => setActiveModule('KDS')}>Mutfağı aç</button>
      ) : null}
    >
      {shown.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Mutfakta açık bilet yok.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((ticket) => (
            <li key={ticket.id} className="queue-row">
              <span className="queue-badge tabular-nums" aria-hidden>{tableTag(ticket.tableName)}</span>
              <span className="min-w-0 flex-1">
                <span className="queue-title">{ticket.tableName}</span>
                <span className="queue-sub tabular-nums">{ticket.ticketNumber} · {ticket.items.length} kalem</span>
              </span>
              <span className="queue-time tabular-nums" data-late={ticket.elapsedMinutes >= 20}>{ticket.elapsedMinutes} dk</span>
            </li>
          ))}
        </ul>
      )}
      {tickets.length > VISIBLE ? (
        <p className="text-xs text-[var(--text-muted)] tabular-nums">{tickets.length - VISIBLE} bilet daha var.</p>
      ) : null}
    </Panel>
  );
};
