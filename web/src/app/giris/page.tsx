import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { LoginForm } from '@/components/account/LoginForm';

export const metadata: Metadata = {
  title: 'Giriş Yap',
  description: 'KASAM360 hesabınıza giriş yapın.',
  alternates: { canonical: '/giris' },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <PageSheet copy="Asıl nüsha">
      <div className="sheet-grid">
        <h1 className="sheet-title">Hesabınıza girin.</h1>
        <div className="min-w-0">
          <LoginForm linkError={error} />
        </div>
      </div>
    </PageSheet>
  );
}
