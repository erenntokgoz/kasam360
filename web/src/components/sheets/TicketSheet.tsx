import { SheetHead } from '@/components/SheetHead';
import { formatMoney } from '@/lib/formatMoney';

const KOFTE_CENTS = 42_000;
const AYRAN_CENTS = 6_000;
const TOTAL_CENTS = 2 * KOFTE_CENTS + AYRAN_CENTS;
const CASH_CENTS = 40_000;
const CARD_CENTS = TOTAL_CENTS - CASH_CENTS;

const steps = [
  {
    title: 'Sipariş fiyatıyla mühürlenir',
    detail: 'Menüde sonradan yapılan zam açık adisyonu değiştirmez.',
    entry: `2 köfte, 1 ayran: ${formatMoney(TOTAL_CENTS)}`,
  },
  {
    title: 'Mutfak ekranına düşer',
    detail: 'Garson hazır olan kalemi kendi ekranında görür.',
    entry: 'hazır, 19.53',
  },
  {
    title: 'Stok gerçek partiden iner',
    detail: 'Reçetedeki malzeme ilk giren partiden bir kez düşer.',
    entry: 'kıyma 360 g, 18 Ekim partisi',
  },
  {
    title: 'Kasa hesabı böler',
    detail: 'Tutara, kaleme veya adede göre; nakit, kart ve cari birlikte.',
    entry: `nakit ${formatMoney(CASH_CENTS)}, kart ${formatMoney(CARD_CENTS)}`,
  },
  {
    title: 'Gün sonu kapanır',
    detail: 'Açık adisyon veya açıklanmamış kasa farkı varsa kapanış tamamlanmaz.',
    entry: `kasa farkı ${formatMoney(0)}`,
  },
];

export function TicketSheet() {
  return (
    <section className="sheet tone-yellow h-full">
      <SheetHead copy="Kasa nüshası" />
      <h2 className="sheet-subtitle max-w-4xl pb-4">Masa 7’nin adisyonu gün sonuna kadar tek kayıttır.</h2>
      <ol className="flex flex-1 flex-col justify-center">
        {steps.map((step, index) => (
          <li key={step.title} className="form-row gap-x-4 lg:grid-cols-[2rem_minmax(0,5fr)_minmax(0,6fr)]">
            <span className="printed tabular-nums">{index + 1}</span>
            <div className="min-w-0">
              <h3 className="font-bold">{step.title}</h3>
              <p className="text-sm text-ink-soft">{step.detail}</p>
            </div>
            <span className="pen min-w-0 tabular-nums">{step.entry}</span>
          </li>
        ))}
      </ol>
      <p className="pt-3 text-sm text-ink-soft">Tutarlar örnektir.</p>
    </section>
  );
}
