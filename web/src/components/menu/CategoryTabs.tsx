'use client';

import { useEffect, useRef } from 'react';
import { sectionId } from '@/lib/menuView';
import type { MenuCategory } from '@/lib/qrMenu';

// Yapışkan, yatay kaydırılan sekmeler. Bağlantılar gerçek çapa olduğu için betik olmadan da çalışır;
// tıklama yumuşak kaydırmayı üst bileşene bırakır.
export function CategoryTabs({ categories, activeId, onSelect }: {
  categories: MenuCategory[]; activeId: string | null; onSelect: (categoryId: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);

  // Etkin sekme şeridin ortasına getirilir; sayfa değil yalnız şerit kayar.
  useEffect(() => {
    const container = rail.current;
    const tab = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !tab) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left: tab.offsetLeft - (container.clientWidth - tab.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [activeId]);

  return (
    <nav className="m-tabs" aria-label="Kategoriler">
      <div className="m-tabs-rail" ref={rail}>
        {categories.map((category) => (
          <a
            key={category.id}
            href={`#${sectionId(category.id)}`}
            className="m-tab"
            aria-current={category.id === activeId ? 'true' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onSelect(category.id);
            }}
          >
            {category.name}
          </a>
        ))}
      </div>
    </nav>
  );
}
