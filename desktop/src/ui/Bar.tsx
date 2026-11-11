import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { cn } from '../lib/cn';
import { prefersReducedMotion } from '../lib/motion';

interface BarProps {
  label: string;
  /** İç sekme seviyesi: çerçevesiz hap grubu (segment) olarak çizilir, vurgu çizgisi taşımaz. */
  plain?: boolean;
  /** Sayfa başlığı: birinci seviye sekmelerin üstünde tek başlık bandı oluşturur. */
  title?: string;
  /** Başlığın sağında üçüncü seviye denetim için boş yuva kimliği (portal hedefi). */
  titleSlotId?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** Bütün ekranların tek gezinme şeridi: birinci seviye metin sekmeleri, iç seviye segment kontrol. */
export const Bar: React.FC<BarProps> = ({ label, plain, title, titleSlotId, actions, children }) => {
  const tabsRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  // Vurgu çizgisi yalnız transform ile kayar; düşük cihaz ve hareket azaltmada anında yerleşir.
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const ink = inkRef.current;
    if (plain || !tabs || !ink) return undefined;
    const place = (animate: boolean) => {
      const active = tabs.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) { gsap.set(ink, { opacity: 0 }); return; }
      const state = { x: active.offsetLeft + 14, scaleX: Math.max(active.offsetWidth - 28, 8), opacity: 1 };
      const calm = prefersReducedMotion() || document.documentElement.dataset.perf === 'low';
      if (animate && placed.current && !calm) gsap.to(ink, { ...state, duration: 0.32, ease: 'power3.out', overwrite: true });
      else gsap.set(ink, state);
      placed.current = true;
    };
    place(true);
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  return (
    <div className={cn('bar', plain && 'bar-plain')}>
      {title ? (
        <div className="bar-head">
          <h1 className="bar-title">{title}</h1>
          {titleSlotId ? <div id={titleSlotId} className="bar-head-slot" /> : null}
        </div>
      ) : null}
      <div className="bar-row">
        <div ref={tabsRef} className="bar-tabs" role="tablist" aria-label={label}>
          {children}
          {plain ? null : <span ref={inkRef} className="bar-ink" aria-hidden="true" />}
        </div>
        {actions ? <div className="bar-actions">{actions}</div> : null}
      </div>
    </div>
  );
};

interface BarTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  /** Sekme yanında küçük sayaç rozeti. */
  count?: number;
}

export const BarTab: React.FC<BarTabProps> = ({ active, count, className, children, ...props }) => (
  <button type="button" role="tab" aria-selected={active} className={cn('bar-item', className)} {...props}>
    {children}
    {count !== undefined ? <span className="bar-count">{count}</span> : null}
  </button>
);

interface BarActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'danger';
}

export const BarAction: React.FC<BarActionProps> = ({ tone, className, ...props }) => (
  <button
    type="button"
    className={cn('bar-item', tone === 'primary' && 'bar-primary', tone === 'danger' && 'bar-danger', className)}
    {...props}
  />
);
