import React from 'react';
import { cn } from '../../../lib/cn';

interface PanelProps {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Pano kartı: aynı başlık ve cam yüzey bütün kartları tek sistemde tutar. */
export const Panel: React.FC<PanelProps> = ({ title, subtitle, aside, className, children }) => (
  <section className={cn('dash-card h-full flex flex-col gap-3 min-w-0', className)}>
    <header className="flex items-start justify-between gap-2 min-h-6">
      <div className="min-w-0">
        <h2 className="dash-card-title">{title}</h2>
        {subtitle ? <p className="dash-card-sub">{subtitle}</p> : null}
      </div>
      {aside}
    </header>
    {children}
  </section>
);
