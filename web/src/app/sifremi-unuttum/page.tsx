import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { ForgotPasswordForm } from '@/components/account/PasswordForms';

export const metadata: Metadata = {
  title: 'Şifremi Unuttum',
  description: 'KASAM360 hesabınızın şifresini yenileyin.',
  alternates: { canonical: '/sifremi-unuttum' },
};

export default function ForgotPasswordPage() {
  return (
    <PageSheet tone="pink" copy="Mutfak nüshası">
      <div className="sheet-grid">
        <h1 className="sheet-title">Şifrenizi yenileyelim.</h1>
        <div className="min-w-0">
          <ForgotPasswordForm />
        </div>
      </div>
    </PageSheet>
  );
}
