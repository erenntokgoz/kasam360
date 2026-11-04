import type { MetadataRoute } from 'next';
import { siteConfig } from '@/content/siteConfig';

const paths = ['', '/ozellikler', '/abonelik', '/sorular', '/kayit', '/giris', '/iletisim', '/kullanim-sartlari', '/gizlilik', '/kvkk', '/iade'];

export default function sitemap(): MetadataRoute.Sitemap {
  return paths.map((path) => ({ url: `${siteConfig.url}${path}` }));
}
