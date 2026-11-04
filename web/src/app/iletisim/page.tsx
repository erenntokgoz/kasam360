import type { Metadata } from 'next';
import Link from 'next/link';
import { PageSheet } from '@/components/PageSheet';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = {
  title: 'İletişim',
  description: 'KASAM360 iletişim bilgileri.',
  alternates: { canonical: '/iletisim' },
};

export default function ContactPage() {
  return (
    <PageSheet>
      <h1 className="sheet-title">Bize yazın.</h1>
      <div className="max-w-xl">
        <div className="form-row grid-cols-[6rem_1fr]">
          <span className="printed">E-posta</span>
          <a href={`mailto:${siteConfig.contactEmail}`} className="pen break-all underline">
            {siteConfig.contactEmail}
          </a>
        </div>
        <div className="form-row grid-cols-[6rem_1fr]">
          <span className="printed">Satıcı</span>
          <span className="pen">{siteConfig.sellerName}</span>
        </div>
      </div>
      <div>
        <Link href="/kayit" className="btn">
          Kayıt Olun
        </Link>
      </div>
    </PageSheet>
  );
}
