import Link from 'next/link';
import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';
import { AccountPanel } from '@/components/account/AccountPanel';

export const metadata: Metadata = {
  title: 'Hesabım',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <PageShell title="Hesabım">
      <AccountPanel />
      <div className="k-row" style={{ marginTop: 24 }}>
        <Link href="/destek" className="k-btn k-btn-line">Destek taleplerim</Link>
      </div>
    </PageShell>
  );
}
