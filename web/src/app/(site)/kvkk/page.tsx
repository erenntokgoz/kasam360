import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { LegalPage } from '@/components/LegalPage';
import { siteConfig } from '@/content/siteConfig';

export const metadata: Metadata = pageMetadata({
  title: 'KVKK Aydınlatma Metni',
  description: 'KASAM360 hesabı için 6698 sayılı Kanun kapsamında aydınlatma metni.',
  path: '/kvkk',
});

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
            'Kayıt formundaki ad soyad, işletme adı, e-posta ve telefon bilgileri, şifrenizin geri çevrilemez özeti ve onay zamanı hesabınızı açmak, oturumunuzu yönetmek ve sizinle iletişim kurmak amacıyla işlenir.',
          ],
        },
        {
          title: 'Hukuki sebep ve toplama yöntemi',
          paragraphs: [
            'Veriler internet sitesindeki form veya seçtiğiniz Google hesabı aracılığıyla elektronik ortamda ve açık rızanıza dayanılarak toplanır. Google ile girişte yalnız adınız, e-postanız ve profil bilginiz alınır.',
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
          paragraphs: ['Veriler hesabınız açık kaldığı sürece saklanır. Hesabınızın silinmesini istediğinizde silinir.'],
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
