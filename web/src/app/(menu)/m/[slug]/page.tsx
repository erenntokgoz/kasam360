import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MenuView } from '@/components/menu/MenuView';
import { displayName, fetchPublicMenu } from '@/lib/qrMenu';

// Menü 30 sn'de bir yenilenir (sözleşmedeki max-age ile aynı); yayın değişince müşteri en geç bir dakikada görür.
export const revalidate = 30;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicMenu(slug);
  if (result.status === 'not-found') return { title: 'Menü bulunamadı', robots: { index: false } };
  const name = displayName(result.menu);
  return { title: `${name} Menü`, description: `${name} menüsü ve fiyatları.`, openGraph: { title: `${name} Menü` } };
}

export default async function MenuPage({ params }: Params) {
  const { slug } = await params;
  const result = await fetchPublicMenu(slug);
  if (result.status === 'not-found') notFound();
  return <MenuView menu={result.menu} />;
}
