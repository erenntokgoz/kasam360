import type { Metadata } from 'next';
import { EarlyAccessForm } from '@/components/EarlyAccessForm';
import { PageSheet } from '@/components/PageSheet';

export const metadata: Metadata = {
  title: 'Erken Erişim',
  description: 'KASAM360 adisyon programının erken erişim listesine işletmenizi ekleyin.',
  alternates: { canonical: '/erken-erisim' },
};

const nextSteps = [
  'Talebiniz bize ulaşır.',
  'Gerçek cihaz testleri tamamlanır.',
  'Listedeki işletmelere yazıp fiyatı ve başlangıcı paylaşırız.',
];

export default function EarlyAccessPage() {
  return (
    <PageSheet tone="yellow" copy="Kasa nüshası">
      <div className="sheet-grid">
        <header className="flex min-w-0 flex-col gap-6">
          <h1 className="sheet-title">İşletmenizi listeye yazalım.</h1>
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
          <EarlyAccessForm />
        </div>
      </div>
    </PageSheet>
  );
}
