import type { ReactNode } from 'react';
import { SheetHead } from '@/components/SheetHead';

interface PageSheetProps {
  tone?: 'white' | 'pink' | 'yellow' | 'green';
  copy?: string;
  children: ReactNode;
}

// İç sayfalar defterin tek yaprağıdır; koparma hareketi yalnız ana sayfada vardır.
export function PageSheet({ tone = 'white', copy, children }: PageSheetProps) {
  return (
    <div className="gutter pt-1">
      <article className={`sheet tone-${tone} gap-8`}>
        <SheetHead copy={copy} colored={tone === 'white'} />
        {children}
      </article>
    </div>
  );
}
