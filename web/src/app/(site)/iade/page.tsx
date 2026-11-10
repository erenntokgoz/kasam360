import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { LegalPage } from '@/components/LegalPage';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = pageMetadata({
  title: 'İade Koşulları',
  description: 'KASAM360 abonelik iade koşullarının durumu.',
  path: '/iade',
});

export default function RefundPage() {
  return (
    <LegalPage
      title="İade Koşulları"
      sections={[
        {
          title: 'Mevcut durum',
          paragraphs: ['KASAM360 şu anda ödeme almamaktadır. Bu nedenle iade gerektiren bir işlem yoktur.'],
        },
        {
          title: 'Ödeme açıldığında',
          paragraphs: [
            'İade süresi ve koşulları abonelik başlamadan önce bu sayfada yayımlanır ve satın alma sırasında gösterilir.',
          ],
        },
        {
          title: 'İletişim',
          paragraphs: [`İade konusundaki sorularınız için ${siteConfig.contactEmail} adresine yazabilirsiniz.`],
        },
      ]}
    />
  );
}
