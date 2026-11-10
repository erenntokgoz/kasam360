import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export const metadata: Metadata = pageMetadata({
  title: 'Adisyon Programı Özellikleri',
  description: 'Masa, mutfak, tahsilat, stok, cari, personel ve yedekleme özellikleri.',
  path: '/ozellikler',
});

const groups = [
  {
    title: 'Masa ve sipariş',
    items: [
      'Masa düzeni, sipariş ve ürün seçenekleri',
      'Masa seçmeden tezgâh satışı',
      'Fiyat ve KDV oranı sipariş anında kaleme mühürlenir',
      'Adisyon ve fiş yazdırma',
    ],
  },
  {
    title: 'Mutfak',
    items: [
      'Mutfak ekranında bekleyen ve hazır kalemler',
      'Garson hazır kalemleri kendi ekranında görür',
      'Hazırlık öncesi iptalde stok aynı partiye döner',
      'Hazırlık sonrası kayıp gerekçeli fire olarak yazılır',
    ],
  },
  {
    title: 'Tahsilat ve kasa',
    items: [
      'Tam, tutara, kaleme veya adede göre hesap bölme',
      'Nakit, kart ve müşteri carisi aynı tahsilatta',
      'Bahşiş havuzu ve personel payı',
      'Nakit ve kart ayrı sayılan vardiya kapanışı',
    ],
  },
  {
    title: 'Stok ve reçete',
    items: [
      'Mal kabulü, parti ve son kullanma tarihi',
      'Gerçek FIFO maliyeti ve reçete düşümü',
      'Üretim, sayım, fire ve kritik stok',
      'Hammadde, yarı mamul ve hazır ürün',
    ],
  },
  {
    title: 'Cari hesaplar',
    items: [
      'Müşteri ve tedarikçi kartları',
      'Borç, alacak, vade ve kısmi ödeme',
      'Ekstre ve bağlı belge görünümü',
      'Mal kabulünde “Belge bekleniyor” takibi',
    ],
  },
  {
    title: 'Personel ve denetim',
    items: [
      'Patron, müdür, kasiyer, garson ve mutfak rolleri',
      'PIN girişi, vardiya ve hak ediş',
      'İptal ve ikramda yetkili PIN onayı',
      'Kritik işlemler için değiştirilemez denetim kaydı',
    ],
  },
  {
    title: 'Menü',
    items: [
      'Kategori, ürün, seçenek ve fiyat listesi',
      'Toplu fiyat güncellemesi',
      'Satışta ve tükendi durumu',
      'Statik QR menü dosyası ve müşteri talebi',
    ],
  },
  {
    title: 'Cihaz ve yedek',
    items: [
      'İnternetsiz çalışma, aynı yerel ağda çoklu cihaz',
      'Eşleştirme koduyla yeni cihaz bağlama',
      'Saatlik, gün sonu ve elle doğrulanmış yedek',
      'Harici disk veya ağ paylaşımına ikinci kopya',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <PageShell
      title="Servisin bütün işi tek uygulamada."
      lead="Windows üzerinde çalışır. Burada yalnız uygulamada bulunan işlevler yazılıdır."
    >
      <div className="k-groups">
        {groups.map((group) => (
          <section key={group.title} className="min-w-0">
            <h2>{group.title}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="k-note">
        <h2 className="k-section-title">Bu sürümde olmayanlar</h2>
        <p>
          Paket servis platformu entegrasyonu, arayan numara gösterme, çoklu şube yönetimi, e-Adisyon ve yazar kasa
          entegrasyonu yoktur. Mali belgeyi mevcut yazar kasanız keser.
        </p>
      </section>

      <div className="k-row" style={{ marginTop: 32 }}>
        <Link href="/kayit" className="k-btn k-btn-buy k-btn-lg">Kayıt olun</Link>
      </div>
    </PageShell>
  );
}
