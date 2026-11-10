import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#icerik" className="skip-link">
        İçeriğe geç
      </a>
      <SiteHeader />
      <main id="icerik" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
