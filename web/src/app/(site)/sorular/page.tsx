import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { PageShell } from '@/components/PageShell';

export const metadata: Metadata = pageMetadata({
  title: 'Sık Sorulan Sorular',
  description: 'KASAM360 adisyon programının internet, cihaz, yazar kasa, veri ve abonelik hakkındaki yanıtları.',
  path: '/sorular',
});

const questions = [
  {
    question: 'İnternet olmadan gerçekten çalışır mı?',
    answer:
      'Evet. Cihazlar aynı Wi-Fi veya kablolu ağda birbirleriyle çalışır, satış için internet gerekmez. Yalnız lisansın ilk etkinleştirilmesi için bir kez internet gerekir.',
  },
  {
    question: 'Modem de kapanırsa ne olur?',
    answer:
      'Yerel ağdan tamamen kopan cihaz açık kayıtları korur, yeni işlem açmaz ve bağlantı dönünce eşitlenir. Tek cihazlı kurulumda satış sürer.',
  },
  {
    question: 'Hangi cihazlarda çalışır?',
    answer: 'KASAM360 Windows uygulamasıdır. Kasa, garson ve mutfak için aynı ağdaki Windows cihazlar kullanılır.',
  },
  {
    question: 'Yazar kasanın yerine geçer mi?',
    answer:
      'Hayır. KASAM360 işletme yönetimi ve adisyon yazılımıdır. Mali belgeyi mevcut yazar kasanız keser. Şu anda e-Adisyon ve yazar kasa entegrasyonu yoktur.',
  },
  {
    question: 'Verilerim nerede duruyor?',
    answer:
      'Veriler işletmenizin cihazında durur. Uygulama saatte bir, her gün sonunda ve elle yedek alır. Ayarlardan harici disk veya ağ paylaşımına ikinci kopya tanımlayabilirsiniz.',
  },
  {
    question: 'Elektrik kesilirse tahsilat yarım kalır mı?',
    answer:
      'Tahsilat ya tam yazılır ya hiç yazılmaz. Bu davranış gerçek cihazlarda elektrik kesintisi testleriyle doğrulanmadan ürün satışa açılmaz.',
  },
  {
    question: 'Abonelik bitince verilerime ne olur?',
    answer:
      'Yeni satış durur. Açık adisyonu kapatma, raporlar, yedek ve veri dışa aktarma açık kalır. Verileriniz kilitlenmez.',
  },
  {
    question: 'Fiyat ne kadar, ne zaman başlayabilirim?',
    answer:
      'Abonelik işletme başına aylık veya yıllıktır. Yayımlanan paketler ve tutarlar Abonelik sayfasındadır. Online ödeme gerçek cihaz testleri bitince açılır; kayıtlı işletmelere e-posta gönderilir.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: questions.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
};

export default function QuestionsPage() {
  return (
    <PageShell title="Aklınızdaki sorular." layout="split"
      intro={
        <div className="k-row">
          <Link href="/kayit" className="k-btn k-btn-buy k-btn-lg">Kayıt olun</Link>
          <Link href="/iletisim" className="k-btn k-btn-line k-btn-lg">Bize yazın</Link>
        </div>
      }
    >
      <JsonLd data={faqSchema} />
      <div className="k-faq">
        {questions.map((item, index) => (
          <details key={item.question} open={index === 0}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </PageShell>
  );
}
