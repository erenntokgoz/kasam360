import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { ResetPasswordForm } from '@/components/account/PasswordForms';

export const metadata: Metadata = {
  title: 'Şifre Yenile',
  robots: { index: false },
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <PageSheet tone="pink" copy="Mutfak nüshası">
      <div className="sheet-grid">
        <h1 className="sheet-title">Yeni şifrenizi yazın.</h1>
        <div className="min-w-0">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </PageSheet>
  );
}
