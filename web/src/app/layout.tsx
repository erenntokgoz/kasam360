import type { Metadata, Viewport } from 'next';
import { Kalam, Schibsted_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { siteConfig } from '@/content/siteConfig';
import './globals.css';

// Yazı tipleri derlemede sitenin içine alınır; ziyaretçinin verisi üçüncü taraf yazı tipi sunucusuna gitmez.
const grotesk = Schibsted_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-grotesk',
});
const kalam = Kalam({
  subsets: ['latin', 'latin-ext'],
  weight: ['400'],
  variable: '--font-kalam',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: 'KASAM360', template: '%s | KASAM360' },
  description: siteConfig.description,
  openGraph: {
    title: 'KASAM360: İnternetsiz Çalışan Adisyon Programı',
    description: siteConfig.description,
    url: '/',
    siteName: siteConfig.name,
    locale: 'tr_TR',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#14161c',
  viewportFit: 'cover',
};

// Boyamadan önce çalışır; kalem izi hazırlanmadan yazının bir kare görünmesini engeller.
const jsMarker = "document.documentElement.classList.add('js')";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" data-scroll-behavior="smooth" suppressHydrationWarning className={`${grotesk.variable} ${kalam.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: jsMarker }} />
      </head>
      <body>
        <a href="#icerik" className="skip-link">
          İçeriğe geç
        </a>
        <SiteHeader />
        <main id="icerik" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
