// Yasal ad ve iletişim tek yerde durur; yayından önce gerçek satıcı bilgileri buraya girilir.
export const siteConfig = {
  name: 'KASAM360',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kasam360.com.tr',
  description:
    'Masa servisli restoran ve kafeler için internet kesintisinde durmayan adisyon, mutfak, stok ve kasa programı.',
  contactEmail: 'iletisim@kasam360.com.tr',
  sellerName: 'KASAM360',
  legalUpdatedAt: '31 Ekim 2026',
};

export const navLinks = [
  { href: '/ozellikler', label: 'Özellikler' },
  { href: '/abonelik', label: 'Abonelik' },
  { href: '/sorular', label: 'Sorular' },
  { href: '/iletisim', label: 'İletişim' },
];

export const legalLinks = [
  { href: '/kullanim-sartlari', label: 'Kullanım Şartları' },
  { href: '/gizlilik', label: 'Gizlilik' },
  { href: '/kvkk', label: 'KVKK Aydınlatma' },
  { href: '/iade', label: 'İade Koşulları' },
];
