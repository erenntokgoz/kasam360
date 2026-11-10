
import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';
import { SupportPanel } from '@/components/account/SupportPanel';

export const metadata: Metadata = { title: 'Destek', robots: { index: false } };

export default function SupportPage() {
  return (
    <PageShell title="Destek">
      <SupportPanel />
    </PageShell>
  );
}
