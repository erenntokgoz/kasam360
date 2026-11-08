'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ORDER_FIXTURE as F } from '@/content/orderFixture';
import { formatMoney, formatMoneyAmount } from '@/lib/formatMoney';
import { FLOW_EVENT, STAGE_EVENT, type StageCommand } from './RestaurantStage';
import type { StationId } from '@/components/scene/sceneTypes';

// Makinedeki öndeki siparişle aynı sırada ilerleyen adım şeridi. Sayılar sahnedeki örnek siparişin aynısıdır.
const STEPS: Array<{ id: StationId; name: string; text: string; live: string }> = [
  { id: 'salon', name: 'Salon', text: 'Garson siparişi masada girer.', live: `Masa 12 · ${F.qty} × Ev usulü mantı` },
  { id: 'mutfak', name: 'Mutfak', text: 'Fiş ekrana düşer, süre işler.', live: 'Hazırlanıyor · biri acısız' },
  { id: 'depo', name: 'Depo', text: 'Malzeme en eski partiden düşer.', live: `Lot A ${F.lotA[0]} × ${formatMoneyAmount(F.lotA[1])} · maliyet ${formatMoney(F.costCents)}` },
  { id: 'kasa', name: 'Kasa', text: 'Nakit ve kart ayrı sayılır.', live: `Nakit ${formatMoneyAmount(F.cashCents)} + kart ${formatMoneyAmount(F.cardCents)} = ${formatMoney(F.totalCents)}` },
  { id: 'bulut', name: 'Bulut', text: 'İnternet gelince kayıt gider.', live: 'Sıradaki kayıt eşitlendi' },
];

export function OrderFlow() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onFlow = (e: Event) => { if (!paused) setActive((e as CustomEvent<number>).detail); };
    window.addEventListener(FLOW_EVENT, onFlow);
    return () => window.removeEventListener(FLOW_EVENT, onFlow);
  }, [paused]);

  // Bir adıma basılınca makine o istasyona yaklaşır; şerit birkaç saniye o adımda kalır, sonra canlı akışa döner.
  useEffect(() => {
    if (!paused) return undefined;
    const id = window.setTimeout(() => setPaused(false), 9000);
    return () => window.clearTimeout(id);
  }, [paused, active]);

  const focus = (i: number) => {
    setActive(i); setPaused(true);
    const stage = document.getElementById('makine');
    if (stage && stage.getBoundingClientRect().bottom < 120) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      stage.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    }
    window.dispatchEvent(new CustomEvent<StageCommand>(STAGE_EVENT, { detail: { focus: STEPS[i].id } }));
  };

  return (
    <section className="k-flow" id="siparis-yolu" aria-labelledby="k-flow-title">
      <div className="k-wrap">
        <header className="k-flow-head">
          <h2 id="k-flow-title">Bir siparişin yolu</h2>
          <p className="k-flow-live k-num" aria-live="polite">
            <span className="k-dot" data-paused={paused} aria-hidden="true" />
            <b>{STEPS[active].name}</b>
            <span>{STEPS[active].live}</span>
          </p>
        </header>
        <ol className="k-flowline" style={{ '--k-at': active } as CSSProperties}>
          {STEPS.map((s, i) => (
            <li key={s.id} data-state={i < active ? 'done' : i === active ? 'active' : 'next'}>
              <button type="button" onClick={() => focus(i)} aria-current={i === active ? 'step' : undefined}>
                <span className="k-node k-num">{String(i + 1).padStart(2, '0')}</span>
                <b>{s.name}</b>
                <span className="k-step-text">{s.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
