import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';
import { ResetPasswordForm } from '@/components/account/PasswordForms';

export const metadata: Metadata = {
  title: 'Şifre Yenile',
  robots: { index: false },
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <PageShell title="Yeni şifrenizi yazın." layout="split">
      <ResetPasswordForm token={token} />
    </PageShell>
  );
}
