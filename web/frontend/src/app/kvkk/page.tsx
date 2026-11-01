import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = {
  title: 'KVKK Aydınlatma Metni',
  description: 'KASAM360 erken erişim formu için 6698 sayılı Kanun kapsamında aydınlatma metni.',
  alternates: { canonical: '/kvkk' },
};

export default function KvkkPage() {
  return (
    <LegalPage
      title="KVKK Aydınlatma Metni"
      sections={[
        {
          title: 'Veri sorumlusu',
          paragraphs: [
            `6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında veri sorumlusu ${siteConfig.sellerName}’dır.`,
          ],
        },
        {
          title: 'İşlenen veriler ve amaç',
          paragraphs: [
            'Erken erişim formundaki ad soyad, işletme adı, e-posta, telefon ve mesaj bilgileri talebinizi değerlendirmek ve sizinle iletişim kurmak amacıyla işlenir.',
          ],
        },
        {
          title: 'Hukuki sebep ve toplama yöntemi',
          paragraphs: [
            'Veriler internet sitesindeki form aracılığıyla elektronik ortamda ve açık rızanıza dayanılarak toplanır.',
          ],
        },
        {
          title: 'Aktarım',
          paragraphs: [
            'Veriler site barındırma ve e-posta iletimi hizmeti alınan, sunucuları yurt dışında bulunabilen sağlayıcılara açık rızanızla aktarılır. Başka üçüncü kişilerle paylaşılmaz.',
          ],
        },
        {
          title: 'Saklama süresi',
          paragraphs: ['Veriler talebiniz sonuçlanana kadar ve en fazla 12 ay saklanır, sonra silinir.'],
        },
        {
          title: 'Haklarınız',
          paragraphs: [
            `Kanunun 11. maddesindeki haklarınızı kullanmak ve rızanızı geri almak için ${siteConfig.contactEmail} adresine yazabilirsiniz.`,
          ],
        },
      ]}
    />
  );
}
