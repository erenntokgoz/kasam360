import React from 'react';
import { CatalogTab } from './CatalogTab';

/** Menü ve stok günlük yönetimden ayrı bir bölümdür. */
export const CatalogModule: React.FC = () => (
  <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
    <CatalogTab />
  </section>
);
