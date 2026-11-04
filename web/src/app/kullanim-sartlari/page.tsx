import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = {
  title: 'Kullanım Şartları',
  description: 'KASAM360 web sitesinin kullanım şartları, ürün durumu ve mali belge açıklaması.',
  alternates: { canonical: '/kullanim-sartlari' },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Kullanım Şartları"
      sections={[
        {
          title: 'Kapsam',
          paragraphs: [
            `Bu şartlar ${siteConfig.url} sitesinin kullanımını düzenler. Site KASAM360 yazılımını tanıtır ve işletme hesabı açar.`,
          ],
        },
        {
          title: 'Ürün durumu',
          paragraphs: [
            'KASAM360 erken erişim aşamasındadır. Sitede ödeme alınmaz ve uygulama indirilemez. Özellikler yayın öncesinde değişebilir.',
          ],
        },
        {
          title: 'Mali belge',
          paragraphs: [
            'KASAM360 işletme yönetimi ve adisyon yazılımıdır. Mali belge yerine geçmez. Mali belge düzenleme yükümlülüğü işletmeye aittir ve mevcut yazar kasa ile yerine getirilir.',
          ],
        },
        {
          title: 'Abonelik',
          paragraphs: [
            'Ödeme açıldığında abonelik koşulları, tutar ve yenileme dönemi satın alma öncesinde gösterilir. Satın alma yetkili ödeme sağlayıcısı aracılığıyla yapılır.',
          ],
        },
        {
          title: 'İletişim',
          paragraphs: [`Sorularınız için ${siteConfig.contactEmail} adresine yazabilirsiniz.`],
        },
      ]}
    />
  );
}
