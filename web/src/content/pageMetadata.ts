import type { Metadata } from 'next';
import { siteConfig } from './siteConfig';

// Paylaşım önizlemesi her sayfada kendi başlığını ve adresini taşımalı; yalnız kök düzende tanımlanırsa
// Next.js bütün sayfalara ana sayfanın og:url ve og:title değerini kopyalar.
export function pageMetadata({ title, description, path, absoluteTitle }: {
  title: string; description: string; path: string; absoluteTitle?: boolean;
}): Metadata {
  const shareTitle = absoluteTitle ? title : `${title} | ${siteConfig.name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description,
      url: path,
      siteName: siteConfig.name,
      locale: 'tr_TR',
      type: 'website',
    },
  };
}
