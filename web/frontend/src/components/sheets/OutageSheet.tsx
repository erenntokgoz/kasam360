'use client';

import { useEffect, useState } from 'react';
import { SheetHead } from '@/components/SheetHead';

const stations = [
  'Garson sipariş girer',
  'Mutfak ekranı siparişi görür',
  'Kasa nakit tahsilat yazar',
  'Stok reçeteden düşer',
];

const outageLog = [
  '19.42 Masa 4: 2 kalem mutfakta',
  '19.43 Masa 7: kalemler hazır',
  '19.44 Masa 2: nakit tahsilat alındı',
  '19.46 Tezgâh: 1 kalem mutfakta',
  '19.47 Masa 9: hesap ikiye bölündü',
];

const ENTRY_MS = 1300;

export function OutageSheet() {
  const [online, setOnline] = useState(true);
  const [written, setWritten] = useState(0);

  // Kesinti sürerken defter dolmaya devam eder; asıl mesaj budur.
  useEffect(() => {
    if (online) return undefined;
    const timer = window.setInterval(() => {
      setWritten((count) => Math.min(count + 1, outageLog.length));
    }, ENTRY_MS);
    return () => window.clearInterval(timer);
  }, [online]);

  const toggleInternet = () => {
    setWritten(0);
    setOnline((value) => !value);
  };

  return (
    <section className="sheet tone-pink h-full">
      <SheetHead copy="Mutfak nüshası" />

      <div className="sheet-grid">
        <div className="flex min-w-0 flex-col items-start justify-between gap-5">
          <h2 className="sheet-subtitle">Akşam servisinde internet kesildi. Şimdi ne olacak?</h2>
          <div className="flex flex-col items-start gap-4">
            <p className="text-ink-soft">Kesip kendiniz bakın.</p>
            <button type="button" className="btn" aria-pressed={!online} onClick={toggleInternet}>
              {online ? 'İnterneti Kes' : 'İnterneti Geri Aç'}
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="form-row form-head min-h-16 grid-cols-[1fr_auto] items-center">
            <span className="font-bold">İnternet</span>
            <span aria-live="polite">
              {online ? <span className="pen">var</span> : <span className="rubber-stamp">KESİLDİ</span>}
            </span>
          </div>
          {stations.map((station) => (
            <div key={station} className="form-row grid-cols-[1fr_auto]">
              <span className="min-w-0">{station}</span>
              <span className="pen">Devam ediyor</span>
            </div>
          ))}
          <ul className="ruled ruled-log overflow-hidden" aria-hidden="true">
            {outageLog.slice(0, written).map((entry) => (
              <li key={entry} className="ruled-entry pen ink-reveal tabular-nums">
                {entry}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="max-w-3xl pt-4 text-sm text-ink-soft">
        Cihazların aynı Wi-Fi veya kablolu ağda kalması gerekir. Modem tamamen kapanırsa kopan cihaz açık kayıtları
        korur, yeni işlem açmaz. Tek cihazlı kurulumda satış sürer.
      </p>
    </section>
  );
}
