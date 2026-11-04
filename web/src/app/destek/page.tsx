
import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { SupportPanel } from '@/components/account/SupportPanel';

export const metadata: Metadata = { title: 'Destek', robots: { index: false } };

export default function SupportPage() {
  return <PageSheet tone="green"><h1 className="sheet-subtitle">Destek</h1><SupportPanel /></PageSheet>;
}
