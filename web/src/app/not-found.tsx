import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export const metadata: Metadata = { title: 'Sayfa bulunamadı', robots: { index: false } };

export default function NotFound() {
  return (
    <PageShell title="Bu sayfa yok." lead="Adres değişmiş ya da yanlış yazılmış olabilir.">
      <div className="k-row">
        <Link href="/" className="k-btn k-btn-ink k-btn-lg">Ana sayfaya dön</Link>
        <Link href="/sorular" className="k-btn k-btn-line k-btn-lg">Sık sorulan sorular</Link>
      </div>
    </PageShell>
  );
}
