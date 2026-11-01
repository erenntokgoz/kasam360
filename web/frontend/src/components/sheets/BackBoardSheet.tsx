import Link from 'next/link';

// Defterin karton arkası: yapraklar bitince okunacak son bilgi burada durur.
export function BackBoardSheet() {
  return (
    <section className="sheet tone-board h-full">
      <div className="sheet-grid pt-5">
        <div className="flex min-w-0 flex-col items-start justify-between gap-8">
          <h2 className="sheet-title">Defteri kaldırın, yazar kasanız kalsın.</h2>
          <Link href="/erken-erisim" className="btn">
            Erken Erişim Listesine Yazılın
          </Link>
        </div>

        <div className="flex min-w-0 flex-col justify-end gap-8">
          <div className="flex flex-col gap-2 border-t-2 border-ink pt-4">
            <h3 className="text-2xl font-bold tracking-tight">Mali belge</h3>
            <p className="text-lg">
              KASAM360 işletme yönetimi ve adisyon yazılımıdır. Mali belgeyi mevcut yazar kasanız keser. Şu anda
              e-Adisyon ve yazar kasa entegrasyonu yoktur.
            </p>
          </div>
          <div className="flex flex-col gap-2 border-t-2 border-ink pt-4">
            <h3 className="text-2xl font-bold tracking-tight">Ürünün durumu</h3>
            <p className="text-lg">
              Gerçek cihaz testleri henüz bitmedi. Şu anda ödeme alınmıyor ve uygulama indirilemiyor. Testler bitince
              listedeki işletmelere yazıyoruz.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
