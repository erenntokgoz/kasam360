import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { PageShell } from '@/components/PageShell';
import { ForgotPasswordForm } from '@/components/account/PasswordForms';

export const metadata: Metadata = pageMetadata({
  title: 'Şifremi Unuttum',
  description: 'KASAM360 hesabınızın şifresini yenileyin.',
  path: '/sifremi-unuttum',
});

export default function ForgotPasswordPage() {
  return (
    <PageShell title="Şifrenizi yenileyelim." layout="split">
      <ForgotPasswordForm />
    </PageShell>
  );
}
