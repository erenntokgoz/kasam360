import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = {
  title: 'Gizlilik',
  description: 'KASAM360 sitesinde hangi bilgilerin toplandığı ve nasıl kullanıldığı.',
  alternates: { canonical: '/gizlilik' },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Gizlilik"
      sections={[
        {
          title: 'Toplanan bilgiler',
          paragraphs: [
            'Site yalnız erken erişim formunda yazdığınız ad soyad, işletme adı, e-posta, telefon ve mesajı alır.',
            'Reklam veya analiz çerezi kullanılmaz. Sayfa açılış animasyonunun tekrar etmemesi için tarayıcınızda yalnız oturum süresince tutulan bir işaret saklanır.',
          ],
        },
        {
          title: 'Kullanım amacı',
          paragraphs: ['Bilgiler erken erişim talebinizi yanıtlamak için kullanılır ve satılmaz.'],
        },
        {
          title: 'Hizmet sağlayıcılar',
          paragraphs: [
            'Site barındırma ve e-posta iletimi için hizmet sağlayıcılar kullanır. Bu sağlayıcıların sunucuları yurt dışında bulunabilir.',
          ],
        },
        {
          title: 'Haklarınız',
          paragraphs: [
            `Bilgilerinizin silinmesini veya düzeltilmesini ${siteConfig.contactEmail} adresinden isteyebilirsiniz. Ayrıntılar KVKK aydınlatma metnindedir.`,
          ],
        },
      ]}
    />
  );
}
