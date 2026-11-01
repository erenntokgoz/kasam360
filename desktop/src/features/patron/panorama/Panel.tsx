import React from 'react';

interface PanelProps {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/** Pano bölmesi: aynı başlık ve kenarlık bütün kartları tek sistemde tutar. */
export const Panel: React.FC<PanelProps> = ({ title, aside, children }) => (
  <section className="h-full paper border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3 min-w-0">
    <header className="flex items-center justify-between gap-2 min-h-6">
      <h2 className="print-title text-xl">{title}</h2>
      {aside}
    </header>
    {children}
  </section>
);
