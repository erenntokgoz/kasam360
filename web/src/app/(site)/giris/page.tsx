import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { PageShell } from '@/components/PageShell';
import { LoginForm } from '@/components/account/LoginForm';

export const metadata: Metadata = pageMetadata({
  title: 'Giriş Yap',
  description: 'KASAM360 hesabınıza giriş yapın.',
  path: '/giris',
});

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <PageShell title="Hesabınıza girin." layout="split">
      <LoginForm linkError={error} />
    </PageShell>
  );
}
