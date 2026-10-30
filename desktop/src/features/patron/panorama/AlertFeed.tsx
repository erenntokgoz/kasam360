import React from 'react';
import { AlertTriangle, ChevronRight, CircleCheck, Info, OctagonAlert } from 'lucide-react';
import type { PanoramaAlert } from '../../../stores/panoramaStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { Panel } from './Panel';

const SEVERITY = {
  CRITICAL: { icon: OctagonAlert, tone: 'text-[var(--accent-red)]', label: 'Kritik' },
  WARNING: { icon: AlertTriangle, tone: 'text-[var(--accent-amber)]', label: 'Uyarı' },
  INFO: { icon: Info, tone: 'text-[var(--accent-blue)]', label: 'Bilgi' },
} as const;

const VISIBLE_LIMIT = 6;

/** Her uyarı çözüleceği ekrana götürür; patron sorunu görüp aramak zorunda kalmaz. */
export const AlertFeed: React.FC<{ alerts: PanoramaAlert[] }> = ({ alerts }) => {
  const setActiveErpTab = useLedgerStore((state) => state.setActiveErpTab);
  const shown = alerts.slice(0, VISIBLE_LIMIT);
  return (
    <Panel
      title="Bugün İlgilen"
      aside={
        alerts.length > 0 ? (
          <span className="text-xs font-bold tabular-nums text-[var(--text-secondary)]">{alerts.length} başlık</span>
        ) : null
      }
    >
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <CircleCheck className="w-5 h-5 text-[var(--accent-emerald)]" aria-hidden />
          Şu an bekleyen iş yok.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((alert) => {
            const { icon: Icon, tone, label } = SEVERITY[alert.severity];
            return (
              <li key={`${alert.title}-${alert.detail}`}>
                <button
                  type="button"
                  disabled={!alert.target}
                  onClick={() => setActiveErpTab(alert.target as Parameters<typeof setActiveErpTab>[0])}
                  className="w-full min-h-12 px-2 py-1.5 rounded-lg flex items-center gap-2.5 text-left enabled:cursor-pointer enabled:hover:bg-[var(--bg-subtle)]"
                >
                  <Icon className={`w-5 h-5 shrink-0 ${tone}`} aria-label={label} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{alert.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)] truncate">{alert.detail}</span>
                  </span>
                  {alert.target ? <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-muted)]" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {alerts.length > VISIBLE_LIMIT ? (
        <p className="text-xs text-[var(--text-muted)] tabular-nums">{alerts.length - VISIBLE_LIMIT} başlık daha var.</p>
      ) : null}
    </Panel>
  );
};
