import type { Metadata } from 'next';
import Link from 'next/link';
import { PageSheet } from '@/components/PageSheet';

export const metadata: Metadata = {
  title: 'Abonelik',
  description: 'İşletme başına aylık veya yıllık KASAM360 yazılım aboneliği.',
  alternates: { canonical: '/abonelik' },
};

const terms = [
  { label: 'Satılan ürün', value: 'KASAM360 yazılım aboneliği' },
  { label: 'Fiyat', value: 'İşletme başına' },
  { label: 'Ödeme dönemi', value: 'Aylık veya yıllık' },
  { label: 'Tutar', value: 'Yakında' },
  { label: 'Teslimat', value: 'Windows uygulaması ve lisans anahtarı' },
  { label: 'Ödeme', value: 'Henüz açık değil' },
];

const answers = [
  {
    question: 'Abonelik bitince verilerime ne olur?',
    answer: 'Yeni satış durur. Açık adisyonu kapatma, raporlar, yedek ve veri dışa aktarma açık kalır.',
  },
  {
    question: 'Lisans internetsiz çalışır mı?',
    answer: 'İlk etkinleştirmede bir kez internet gerekir. Sonra uygulama internetsiz çalışır, bağlantı buldukça lisansını yeniler.',
  },
  {
    question: 'Donanım ve kurulum dahil mi?',
    answer: 'Hayır. Abonelik yalnız yazılımı kapsar.',
  },
];

export default function SubscriptionPage() {
  return (
    <PageSheet tone="green" copy="Patron nüshası">
      <header className="flex max-w-3xl flex-col gap-3">
        <h1 className="sheet-title">İşletme başına tek abonelik.</h1>
        <p className="text-ink-soft">Tutarlar ödeme açılmadan önce bu sayfada yayımlanır.</p>
      </header>

      <dl>
        {terms.map((term) => (
          <div key={term.label} className="form-row sm:grid-cols-[14rem_1fr]">
            <dt className="printed">{term.label}</dt>
            <dd className="pen">{term.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex max-w-3xl flex-col gap-5">
        {answers.map((item) => (
          <section key={item.question} className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">{item.question}</h2>
            <p className="text-ink-soft">{item.answer}</p>
          </section>
        ))}
      </div>

      <div>
        <Link href="/kayit" className="btn">
          Fiyat Açıklanınca Haber Alın
        </Link>
      </div>
    </PageSheet>
  );
}
