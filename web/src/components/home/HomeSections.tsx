import Link from 'next/link';
import { RestaurantStage } from './RestaurantStage';
import { OrderFlow } from './OrderFlow';

export function HomeHero() {
  return (
    <section className="k-hero" aria-labelledby="k-hero-title">
      <RestaurantStage />
      <div className="k-veil" />
      <div className="k-copy">
        <h1 id="k-hero-title">İnternet gitse de mutfak durmaz, hesap kapanır.</h1>
        <p>Salon, mutfak, depo ve kasa aynı cihazda çalışır. Bağlantı gelince her kayıt buluta sırasıyla gider.</p>
        <div className="k-go">
          <Link href="/kayit" className="k-btn k-btn-buy k-btn-lg">Kayıt olun</Link>
          <a href="#siparis-yolu" className="k-btn k-btn-line k-btn-lg">Nasıl çalışır</a>
        </div>
      </div>
    </section>
  );
}

const FEATURES = ['Masa ve salon düzeni', 'Mutfak ekranı', 'Reçete ve FIFO maliyet', 'Cari ve tedarikçi', 'QR menü', 'Fire ve iptal radarı'];

export function HomeRoute() {
  return <OrderFlow />;
}

export function HomeFeatures() {
  return (
    <section className="k-plan" aria-labelledby="k-plan-title">
      <div className="k-wrap">
        <div>
          <h2 id="k-plan-title">Tek cihazla başlayın, kasa ekledikçe büyüyün.</h2>
          <p className="k-meta">Paketler, cihaz hakları ve fiyatlar Abonelik sayfasında.</p>
          <div className="k-go">
            <Link href="/abonelik" className="k-btn k-btn-buy k-btn-lg">Abonelik seçenekleri</Link>
            <Link href="/ozellikler" className="k-btn k-btn-line k-btn-lg">Bütün özellikler</Link>
          </div>
        </div>
        <ul className="k-feat">
          {FEATURES.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
    </section>
  );
}
