import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { PageShell } from '@/components/PageShell';
import { RegisterForm } from '@/components/account/RegisterForm';

export const metadata: Metadata = pageMetadata({
  title: 'Kayıt Ol',
  description: 'KASAM360 hesabınızı açın, adisyon programı açıldığında işletmenizle başlayın.',
  path: '/kayit',
});

const nextSteps = ['Hesabınızı açın.', 'E-postanızı doğrulayın.', 'Gerçek cihaz testleri bitince fiyatı ve başlangıcı size yazalım.'];

export default function RegisterPage() {
  return (
    <PageShell
      title="Hesabınızı açalım."
      layout="split"
      intro={
        <>
          <ol className="k-steps">
            {nextSteps.map((step, index) => (
              <li key={step}>
                <span className="k-num">{String(index + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="k-muted k-small">Şu anda ödeme alınmıyor.</p>
        </>
      }
    >
      <RegisterForm />
    </PageShell>
  );
}
