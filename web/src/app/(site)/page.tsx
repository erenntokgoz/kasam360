import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { HomeFeatures, HomeHero, HomeRoute } from '@/components/home/HomeSections';
import { pageMetadata } from '@/content/pageMetadata';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = pageMetadata({
  title: 'KASAM360: İnternetsiz Çalışan Adisyon Programı',
  description: siteConfig.description,
  path: '/',
  absoluteTitle: true,
});

// Fiyat ve puan yazılmaz; yapılandırılmış veri sitede görünmeyen bir şey vaat edemez.
const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: siteConfig.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Windows',
  description: siteConfig.description,
  url: siteConfig.url,
  inLanguage: 'tr',
  publisher: { '@type': 'Organization', name: siteConfig.sellerName, url: siteConfig.url, email: siteConfig.contactEmail },
};

export default function HomePage() {
  return (
    <div className="k-root">
      <JsonLd data={softwareSchema} />
      <HomeHero />
      <HomeRoute />
      <HomeFeatures />
    </div>
  );
}
