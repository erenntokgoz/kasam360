'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { useRef } from 'react';
import { SheetHead } from '@/components/SheetHead';

gsap.registerPlugin(useGSAP);

const PEN_SPEED = 560;
const PEN_HOP = 0.14;

const entries = [
  { quantity: '1', item: 'Sipariş', state: 'garsondan mutfağa gitti' },
  { quantity: '1', item: 'Mutfak', state: 'hazır dedi' },
  { quantity: '1', item: 'Tahsilat', state: 'kasaya yazıldı' },
];

export function OrderSheet() {
  const sheetRef = useRef<HTMLElement>(null);

  // Sayfanın açılış hareketi: garson formu kalemle dolduruyor, hız satırın uzunluğuna bağlı.
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const sheet = sheetRef.current;
        if (!sheet) return;

        const origin = sheet.getBoundingClientRect();
        const lines = gsap.utils.toArray<HTMLElement>('.ink-line').map((element) => {
          const box = element.getBoundingClientRect();
          return {
            element,
            left: box.left - origin.left,
            right: box.right - origin.left,
            y: box.bottom - origin.top - 5,
          };
        });

        const timeline = gsap.timeline({ delay: 0.3 });
        timeline.set('.ballpoint', { x: lines[0].left, y: lines[0].y - 30, rotation: 6 });
        timeline.to('.ballpoint', { autoAlpha: 1, y: lines[0].y, rotation: 0, duration: 0.22, ease: 'power2.out' });

        lines.forEach((line) => {
          const duration = (line.right - line.left) / PEN_SPEED;
          timeline.to('.ballpoint', { x: line.left, y: line.y, duration: PEN_HOP, ease: 'power1.inOut' });
          timeline.to(line.element, { clipPath: 'inset(-10% 0% -10% 0)', duration, ease: 'none' });
          timeline.to('.ballpoint', { x: line.right, duration, ease: 'none' }, '<');
        });

        timeline.to('.ink-circle', { strokeDashoffset: 0, duration: 0.5, ease: 'power1.inOut' }, '+=0.08');
        timeline.to('.ballpoint', { y: '-=70', x: '+=50', autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, '-=0.1');
      });
    },
    { scope: sheetRef },
  );

  return (
    <section ref={sheetRef} className="sheet tone-white h-full">
      <SheetHead copy="Garson nüshası" colored />

      <div className="sheet-grid">
        <div className="flex min-w-0 flex-col items-start justify-between gap-5">
          <h1 className="sheet-title">İnternet gitse de adisyon kapanır.</h1>
          <div className="flex flex-col items-start gap-5">
            <p className="max-w-[32rem] text-ink-soft">
              KASAM360 masa servisli restoran ve kafeler için adisyon, mutfak, stok ve kasa programıdır. Cihazlarınız
              aynı yerel ağda haberleşir, servis internete bağlı kalmaz.
            </p>
            <Link href="/kayit" className="btn">
              Kayıt Olun
            </Link>
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="form-row form-head grid-cols-[auto_1fr_auto]">
            <span className="printed">Masa</span>
            <span className="pen ink-line justify-self-start">7</span>
            <span className="printed">
              İnternet: <span className="pen ink-line inline-block">yok</span>
            </span>
          </div>
          <div className="form-row form-head grid-cols-[3rem_6rem_1fr]">
            <span className="printed">Adet</span>
            <span className="printed">Cinsi</span>
            <span className="printed">Durum</span>
          </div>
          {entries.map((entry) => (
            <div key={entry.item} className="form-row grid-cols-[3rem_6rem_1fr]">
              <span className="pen ink-line justify-self-start">{entry.quantity}</span>
              <span className="pen ink-line justify-self-start">{entry.item}</span>
              <span className="pen ink-line justify-self-start">{entry.state}</span>
            </div>
          ))}
          <div className="ruled" aria-hidden="true" />
          <div className="form-row grid-cols-[auto_1fr] border-t-2 border-b-0 border-t-print pt-3">
            <span className="printed self-center">Toplam</span>
            <span className="relative justify-self-end px-6 py-2">
              <span className="pen ink-line block">servis durmadı</span>
              <svg
                className="absolute inset-0 h-full w-full overflow-visible"
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  className="ink-circle"
                  d="M12 8C38 -2 92 -1 97 18C101 36 34 44 8 34C-8 26 6 8 34 5"
                  pathLength={1}
                  strokeDasharray={1}
                  fill="none"
                  stroke="var(--pen)"
                  strokeWidth={1.3}
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Kalem ucu svg'nin sol alt köşesindedir; konum bu noktaya göre hesaplanır. */}
      <svg className="ballpoint" viewBox="0 0 130 130" aria-hidden="true">
        <g transform="translate(0 130) rotate(38)">
          <path d="M0 0-4-16H4Z" fill="#14161c" />
          <path d="M-4-16-7-40H7L4-16Z" fill="#c8ccd4" />
          <rect x={-7} y={-124} width={14} height={84} fill="#f4f4f0" stroke="#14161c" strokeWidth={1} />
          <rect x={-2} y={-124} width={4} height={84} fill="#1a2ea8" />
          <rect x={-7} y={-150} width={14} height={28} rx={3} fill="#1a2ea8" />
        </g>
      </svg>
    </section>
  );
}
