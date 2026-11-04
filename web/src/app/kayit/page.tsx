import type { Metadata } from 'next';
import { PageSheet } from '@/components/PageSheet';
import { RegisterForm } from '@/components/account/RegisterForm';

export const metadata: Metadata = {
  title: 'Kayıt Ol',
  description: 'KASAM360 hesabınızı açın, adisyon programı açıldığında işletmenizle başlayın.',
  alternates: { canonical: '/kayit' },
};

const nextSteps = ['Hesabınızı açın.', 'E-postanızı doğrulayın.', 'Gerçek cihaz testleri bitince fiyatı ve başlangıcı size yazalım.'];

export default function RegisterPage() {
  return (
    <PageSheet tone="yellow" copy="Kasa nüshası">
      <div className="sheet-grid">
        <header className="flex min-w-0 flex-col gap-6">
          <h1 className="sheet-title">Hesabınızı açalım.</h1>
          <ol className="flex flex-col">
            {nextSteps.map((step, index) => (
              <li key={step} className="form-row grid-cols-[2rem_1fr]">
                <span className="printed tabular-nums">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-ink-soft">Şu anda ödeme alınmıyor.</p>
        </header>
        <div className="min-w-0">
          <RegisterForm />
        </div>
      </div>
    </PageSheet>
  );
}
