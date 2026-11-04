import Link from 'next/link';
import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { AccountPanel } from '@/components/account/AccountPanel';

export const metadata: Metadata = {
  title: 'Hesabım',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <PageSheet tone="green" copy="Patron nüshası">
      <h1 className="sheet-subtitle">Hesabım</h1>
      <AccountPanel />
      <Link href="/destek" className="btn">Destek Taleplerim</Link>
    </PageSheet>
  );
}
