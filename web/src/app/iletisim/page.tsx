import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = pageMetadata({
  title: 'İletişim',
  description: 'KASAM360 e-posta adresi ve destek talebi.',
  path: '/iletisim',
});

export default function ContactPage() {
  return (
    <PageShell title="Bize yazın." layout="split"
      intro={
        <div className="k-row">
          <Link href="/destek" className="k-btn k-btn-ink k-btn-lg">Destek talebi açın</Link>
          <Link href="/kayit" className="k-btn k-btn-line k-btn-lg">Kayıt olun</Link>
        </div>
      }
    >
      <dl className="k-dl">
        <div>
          <dt>E-posta</dt>
          <dd><a href={`mailto:${siteConfig.contactEmail}`} className="k-link">{siteConfig.contactEmail}</a></dd>
        </div>
        <div>
          <dt>Satıcı</dt>
          <dd>{siteConfig.sellerName}</dd>
        </div>
      </dl>
    </PageShell>
  );
}
