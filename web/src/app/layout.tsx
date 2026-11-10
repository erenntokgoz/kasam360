import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { siteConfig } from '@/content/siteConfig';
import './globals.css';
import './k5.css';
import './k5-pages.css';

// Yazı tipleri derlemede sitenin içine alınır; ziyaretçinin verisi üçüncü taraf yazı tipi sunucusuna gitmez.
const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: 'KASAM360', template: '%s | KASAM360' },
  description: siteConfig.description,
  // Sayfa adresi ve başlığı her sayfanın kendi pageMetadata çağrısından gelir; burada yalnız ortak değerler var.
  openGraph: {
    description: siteConfig.description,
    siteName: siteConfig.name,
    locale: 'tr_TR',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#f7f6f3',
  viewportFit: 'cover',
};

// Tema boyamadan önce kurulur: kayıtlı seçim, yoksa açık tema. Böylece sayfa yanlış temada yanıp sönmez.
// Müşteri menüsü (menu)/layout.tsx içinde bunun üstüne, kayıt yoksa cihaz temasını izleyen kendi betiğini ekler.
const themeInit =
  "try{var s=localStorage.getItem('k360-theme');document.documentElement.dataset.theme=s==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}";

// Üst menü ve alt bilgi burada değil (site)/layout.tsx içindedir: müşteri menüsü sitenin çerçevesini taşımaz.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" data-scroll-behavior="smooth" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
