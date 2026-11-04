import { SheetHead } from '@/components/SheetHead';

const rules = [
  {
    title: 'Aynı ödeme iki kez yazılmaz.',
    detail: 'İki terminal aynı anda Tamamla dese de tek tahsilat işlenir. Finansal çakışmada son yazan kazanmaz.',
  },
  {
    title: 'Kapanan adisyon silinmez.',
    detail: 'Değişiklik müdür onayıyla yapılır, önceki kayıt korunur. Kim, ne zaman, hangi gerekçeyle işlem yaptı, patronun önündedir.',
  },
  {
    title: 'Kasa açığının yeri bellidir.',
    detail: 'Nakit ve kart ayrı sayılır. Fark açıklanmadan gün kapanmaz.',
  },
];

export function MoneySheet() {
  return (
    <section className="sheet tone-green h-full">
      <SheetHead copy="Patron nüshası" />
      <div className="sheet-grid">
        <h2 className="sheet-title min-w-0">Para hatası sessizce geçmez.</h2>
        <div className="flex min-w-0 flex-col justify-between gap-2">
          {rules.map((rule) => (
            <div key={rule.title} className="form-row flex-1 content-center gap-1.5">
              <h3 className="text-3xl font-extrabold tracking-tight lg:text-4xl">{rule.title}</h3>
              <p className="text-lg text-ink-soft">{rule.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
