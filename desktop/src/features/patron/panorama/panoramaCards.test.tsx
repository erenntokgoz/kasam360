import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { channelShares, PaymentMix } from './PaymentMix';
import { tableBars } from './LivePanel';
import { KpiStrip } from './KpiStrip';
import type { Kpi } from '../../../stores/panoramaStore';

const kpi = (collectedCents: number, orders: number): Kpi => ({
  collectedCents,
  orders,
  averageTicketCents: orders > 0 ? Math.floor(collectedCents / orders) : 0,
  refundCents: 0,
  discountCents: 0,
  voidCents: 0,
  vatCents: 0,
  cogsCents: null,
  grossProfitCents: null,
  costIncomplete: false,
  costMissingSales: 0,
});

describe('pano kartları', () => {
  it('kanal payları toplamı 100 yapar', () => {
    const shares = channelShares([100, 100, 100]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
    expect(channelShares([0, 0])).toEqual([0, 0]);
  });

  it('ödeme kanallarında kanal adı ve tutar yazılıdır', () => {
    const html = renderToStaticMarkup(<PaymentMix channels={[{ channel: 'Nakit', amountCents: 125_050 }, { channel: 'Kart', amountCents: 50_000 }]} />);
    expect(html).toContain('Nakit');
    expect(html).toContain('1.250,50');
    expect(html).toContain('%72');
  });

  it('masa çubukları doluluğa orantılıdır ve çok masada sınırlanır', () => {
    expect(tableBars(2, 4).filter(Boolean)).toHaveLength(2);
    expect(tableBars(0, 0)).toEqual([]);
    expect(tableBars(50, 100)).toHaveLength(36);
  });

  it('KPI kutusu seçili dönemi adlandırır ve değişimi gösterir', () => {
    const html = renderToStaticMarkup(
      <KpiStrip current={kpi(20_000, 4)} previous={kpi(10_000, 2)} compareLabel="dün aynı saate göre" periodName="Bugün" />,
    );
    expect(html).toContain('Bugün tahsilat');
    expect(html).toContain('%100');
    expect(html).toContain('Adisyon sayısı');
  });
});
