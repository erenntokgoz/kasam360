import React from 'react';
import { CircleCheck } from 'lucide-react';
import { useLedgerStore } from '../../../stores/ledgerStore';
import type { PanoramaAlert } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

const VISIBLE = 3;

/** Stok uyarıları panodaki uyarı akışından süzülür; her satır stok ekranına götürür. */
export const LowStock: React.FC<{ alerts: PanoramaAlert[] }> = ({ alerts }) => {
  const openAlertTarget = useLedgerStore((state) => state.openAlertTarget);
  const stock = alerts.filter((alert) => alert.target === 'STOCK');
  const shown = stock.slice(0, VISIBLE);
  return (
    <Panel
      title="Azalan Stok"
      subtitle={stock.length > 0 ? `${stock.length} uyarı var` : undefined}
      aside={stock.length > 0 ? (
        <button type="button" className="card-link" onClick={() => openAlertTarget('STOCK')}>Stoğa git</button>
      ) : null}
    >
      {stock.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <CircleCheck className="w-5 h-5 text-[var(--accent-emerald)]" aria-hidden />
          Azalan ürün yok.
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((alert) => (
            <li key={`${alert.title}-${alert.detail}`} className="queue-row">
              <span className="queue-badge" data-tone={alert.severity === 'CRITICAL' ? 'danger' : 'warn'} aria-hidden>
                {alert.title.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="queue-title">{alert.title}</span>
                <span className="queue-sub">{alert.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {stock.length > VISIBLE ? (
        <p className="text-xs text-[var(--text-muted)] tabular-nums">{stock.length - VISIBLE} uyarı daha var.</p>
      ) : null}
    </Panel>
  );
};
