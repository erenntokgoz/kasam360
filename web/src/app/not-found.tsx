import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = { title: 'Sayfa bulunamadı', robots: { index: false } };

// Kök not-found, grup düzenlerinin dışında çizildiği için site çerçevesini kendisi taşır.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="icerik">
        <PageShell title="Bu sayfa yok." lead="Adres değişmiş ya da yanlış yazılmış olabilir.">
          <div className="k-row">
            <Link href="/" className="k-btn k-btn-ink k-btn-lg">Ana sayfaya dön</Link>
            <Link href="/sorular" className="k-btn k-btn-line k-btn-lg">Sık sorulan sorular</Link>
          </div>
        </PageShell>
      </main>
      <SiteFooter />
    </>
  );
}
