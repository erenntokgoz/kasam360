import React from 'react';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaData } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

/** Tek renk çubuk: kanal adı yazılıdır, rengin kimlik taşıması gerekmez. */
export const PaymentMix: React.FC<{ channels: PanoramaData['channels'] }> = ({ channels }) => {
  const total = channels.reduce((sum, item) => sum + item.amountCents, 0);
  return (
    <Panel title="Ödeme Kanalları">
      {total === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu dönemde tahsilat yok.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {channels.map((item) => {
            const share = Math.round((item.amountCents * 100) / total);
            return (
              <li key={item.channel}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">{item.channel}</span>
                  <span className="tabular-nums text-[var(--text-secondary)]">
                    {formatMoney(item.amountCents)} · %{share}
                  </span>
                </div>
                <div className="h-2 mt-1 rounded bg-[var(--bg-subtle)] overflow-hidden">
                  <div className="h-full rounded bg-[var(--accent-blue)]" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};
