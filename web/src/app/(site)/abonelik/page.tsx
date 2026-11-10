import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { formatMoney, formatMoneyAmount } from '@/lib/formatMoney';
import { loadCatalog, type CatalogPackage, type CatalogResponse } from '@/lib/catalogApi';

// Türk lirası ortak para biçimiyle ("1.250,50 TL") yazılır; diğer para birimleri kodlarıyla gösterilir.
const priceText = (price: CatalogPackage['price']) =>
  price.currency === 'TRY' ? formatMoney(price.amountCents) : `${formatMoneyAmount(price.amountCents)} ${price.currency}`;

export const metadata: Metadata = pageMetadata({
  title: 'Abonelik',
  description: 'Yayımlanan KASAM360 paketleri, cihaz hakları ve aylık veya yıllık tutarlar. Online satın alma henüz açık değil.',
  path: '/abonelik',
});

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

export const dynamic = 'force-dynamic';

export default async function SubscriptionPage() {
  let catalog: CatalogResponse | null = null;
  let catalogError = false;
  try { catalog = await loadCatalog(); } catch { catalogError = true; }
  return (
    <PageShell title="İşletme başına tek abonelik." lead="Aylık veya yıllık. Yalnız yazılımı kapsar. Online satın alma henüz açık değil; ödeme açıldığında kayıtlı işletmelere e-posta gönderilir.">
      <div className="k-row k-page-cta">
        <Link href="/kayit" className="k-btn k-btn-buy k-btn-lg">Kayıt olun</Link>
        <Link href="/ozellikler" className="k-btn k-btn-line k-btn-lg">Bütün özellikler</Link>
      </div>
      <div className="k-pricing">
        <section aria-labelledby="published-packages-title">
          <h2 id="published-packages-title" className="k-section-title">Yayımlanan paketler</h2>
          {catalogError && <p className="k-alert" role="alert">Paket ve fiyat bilgisi şu anda alınamıyor. Fiyatı tahmin ederek gösteremiyoruz.</p>}
          {!catalogError && catalog?.packages.length === 0 && <p className="k-muted">Şu anda yayımlanmış paket yok.</p>}
          {!catalogError && catalog && catalog.packages.length > 0 && <div className="k-package-grid">
            {catalog.packages.map((item) => (
              <article className="k-panel k-package-card" data-highlighted={item.highlighted} key={`${item.packageId}:${item.price.priceId}`}>
                <header>
                  {item.highlighted && <span className="k-tag">Öne çıkan</span>}
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                </header>
                <div>
                  <p className="k-package-price">{priceText(item.price)}</p>
                  <p className="k-muted">{item.price.interval === 'month' ? 'Aylık' : 'Yıllık'} · Vergi {item.price.taxBehavior === 'inclusive' ? 'dahil' : 'hariç'}</p>
                </div>
                <p className="k-muted">En fazla {item.deviceLimit} cihaz</p>
                <ul className="k-package-features">
                  {item.features.map((feature) => <li key={feature.key}><strong>{feature.name}</strong><span>{feature.description}</span></li>)}
                </ul>
                <p className="k-package-unavailable">Satın alma henüz açık değil</p>
              </article>
            ))}
          </div>}
        </section>
        <section aria-labelledby="subscription-questions-title">
          <h2 id="subscription-questions-title" className="k-section-title">Abonelik hakkında</h2>
          <div className="k-faq">
            {answers.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
