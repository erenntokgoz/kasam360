import React, { useRef } from 'react';
import { canAnimate, gsap, useGSAP, useRevealKey } from '../../../lib/dashMotion';
import { formatMoney } from '../../../lib/formatMoney';
import type { PanoramaData } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

/** Dilimler kanal sırasına göre döner; kanal adı her satırda yazılıdır, renk kimlik taşımaz. */
const SLICE_COUNT = 5;

/** Kanal payları tam sayı yüzdedir; toplam 100'ü aşmasın diye en büyük dilim farkı alır. */
export function channelShares(amounts: number[]): number[] {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return amounts.map(() => 0);
  const shares = amounts.map((amount) => Math.floor((amount * 100) / total));
  const remainder = 100 - shares.reduce((sum, share) => sum + share, 0);
  const largest = amounts.indexOf(Math.max(...amounts));
  shares[largest] += remainder;
  return shares;
}

export const PaymentMix: React.FC<{ channels: PanoramaData['channels'] }> = ({ channels }) => {
  const root = useRef<HTMLDivElement>(null);
  const total = channels.reduce((sum, item) => sum + item.amountCents, 0);
  const shares = channelShares(channels.map((item) => item.amountCents));

  const revealKey = useRevealKey(root);
  useGSAP(() => {
    if (!canAnimate()) return;
    gsap.from('.mix-slice', { scaleX: 0, transformOrigin: '0 50%', duration: 0.6, ease: 'power2.out', stagger: 0.08 });
  }, { scope: root, dependencies: [shares.join(','), revealKey], revertOnUpdate: true });

  return (
    <Panel title="Ödeme Kanalları">
      {total === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu dönemde tahsilat yok.</p>
      ) : (
        <div ref={root} className="flex flex-col gap-3">
          <div className="mix-bar" role="img" aria-label={channels.map((item, index) => `${item.channel} yüzde ${shares[index]}`).join(', ')}>
            {channels.map((item, index) => (shares[index] > 0 ? (
              <span key={item.channel} className="mix-slice" data-slice={index % SLICE_COUNT} style={{ flexGrow: shares[index] }} />
            ) : null))}
          </div>
          <ul className="flex flex-col">
            {channels.map((item, index) => (
              <li key={item.channel} className="mix-row">
                <span className="mix-key" data-slice={index % SLICE_COUNT} aria-hidden />
                <span className="mix-name">{item.channel}</span>
                <span className="mix-amount tabular-nums">{formatMoney(item.amountCents)}</span>
                <span className="mix-share tabular-nums">%{shares[index]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
};
