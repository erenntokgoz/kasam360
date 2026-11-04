'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Children, useRef, useState, type MouseEvent, type ReactNode } from 'react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export interface PadSheet {
  id: string;
  label: string;
  tone: string;
}

interface PadStackProps {
  sheets: PadSheet[];
  children: ReactNode;
}

const HOLD = 0.4;
const TEAR = 1;

// Dar veya alçak ekranda içerik kesilir, dokunmatikte yakalama parmağın kaydırmasıyla çakışır; orada yapraklar alt alta akar.
const PIN_QUERY =
  '(min-width: 1024px) and (min-height: 720px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

export function PadStack({ sheets, children }: PadStackProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);

  const scrollToSheet = (index: number, behavior: ScrollBehavior) => {
    const trigger = triggerRef.current;
    if (!trigger) return false;
    window.scrollTo({ top: trigger.labelToScroll(`sheet-${index}`), behavior });
    return true;
  };

  const handleTab = (event: MouseEvent<HTMLAnchorElement>, index: number) => {
    if (scrollToSheet(index, 'smooth')) event.preventDefault();
  };

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add(PIN_QUERY, () => {
        const pad = padRef.current;
        if (!pad) return undefined;

        pad.classList.add('is-pinned');
        const slots = gsap.utils.toArray<HTMLElement>('.pad-slot');
        const stubs = gsap.utils.toArray<HTMLElement>('.pad-stub');
        // Şerit kendi yaprağının altında, sonraki yaprakların üstünde durur.
        gsap.set(slots, { zIndex: (index) => (slots.length - index) * 2 });
        gsap.set(stubs, { zIndex: (index) => (slots.length - index) * 2 - 1 });

        const headerHeight = parseInt(getComputedStyle(pad).getPropertyValue('--header-height'), 10);
        const tearOffs = slots.slice(0, -1);
        const timeline = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: pad,
            pin: true,
            start: `top ${headerHeight + 4}px`,
            end: `+=${tearOffs.length * 110}%`,
            scrub: 0.5,
            // Kaydırma hızı hesaba katılırsa tek hareket birkaç yaprağı atlar; her hareket bir yaprak ilerletir.
            snap: {
              snapTo: 'labelsDirectional',
              inertia: false,
              duration: { min: 0.2, max: 0.5 },
              delay: 0.08,
              ease: 'power1.inOut',
            },
            onUpdate: (self) => {
              const time = self.animation?.time() ?? 0;
              setActive(Math.min(sheets.length - 1, Math.floor((time + TEAR / 2) / (HOLD + TEAR))));
            },
          },
        });

        timeline.addLabel('sheet-0');
        tearOffs.forEach((slot, index) => {
          timeline
            .to({}, { duration: HOLD })
            .set(stubs[index], { autoAlpha: 1 })
            .to(slot, { yPercent: -122, rotation: index % 2 === 0 ? -2.6 : 2, duration: TEAR })
            .addLabel(`sheet-${index + 1}`);
        });

        triggerRef.current = timeline.scrollTrigger ?? null;

        // Klavyeyle kapalı bir yaprağa gelinirse o yaprak açılır; odak görünmeyen yerde kalmaz.
        const handleFocus = (event: FocusEvent) => {
          const slot = (event.target as HTMLElement).closest<HTMLElement>('.pad-slot');
          if (slot) scrollToSheet(slots.indexOf(slot), 'auto');
        };
        pad.addEventListener('focusin', handleFocus);

        return () => {
          pad.removeEventListener('focusin', handleFocus);
          pad.classList.remove('is-pinned');
          triggerRef.current = null;
        };
      });
    },
    { scope: padRef },
  );

  return (
    <div ref={padRef} className="pad gutter">
      <nav className="pad-tabs on-desk" aria-label="Yapraklar">
        {sheets.map((sheet, index) => (
          <a
            key={sheet.id}
            href={`#${sheet.id}`}
            className={`pad-tab tone-${sheet.tone}`}
            aria-current={index === active ? 'true' : undefined}
            onClick={(event) => handleTab(event, index)}
          >
            {sheet.label}
          </a>
        ))}
      </nav>

      {sheets.slice(0, -1).map((sheet) => (
        <div key={sheet.id} className={`pad-stub tone-${sheet.tone}`} aria-hidden="true" />
      ))}

      {Children.map(children, (child, index) => (
        <div id={sheets[index]?.id} className="pad-slot">
          {child}
        </div>
      ))}
    </div>
  );
}
