import { describe, expect, it } from 'vitest';
import type { PackageDelivery } from '../types/packageService';
import {
  awaitingSettlement, cartSubtotalCents, durationText, lateMinutes, nextStatus, orderCode, phoneText,
  settlementTotals, toSubmitLines,
} from './packageModel';

const NOW = new Date('2026-11-17T12:00:00Z').getTime();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function row(patch: Partial<PackageDelivery>): PackageDelivery {
  return {
    id: 'dlv_0123456789abcdef01234567', orderId: 'ord_1', customerName: 'Ayşe', phone: '05321112233',
    addressText: 'Gül Sk.', directions: '', source: 'PHONE', externalRef: null, status: 'PREPARING', courierId: null,
    courierName: null, feeCents: 0, totalCents: 1000, paymentMethod: 'CASH', note: '', itemsSummary: '1 x Çay',
    createdAt: minutesAgo(5), readyAt: null, dispatchedAt: null, deliveredAt: null, cancelledAt: null,
    cancelReason: null, settledAt: null, ...patch,
  };
}

describe('paket servis modeli', () => {
  it('gecikme her aşamanın kendi sınırına göre hesaplanır', () => {
    expect(lateMinutes(row({ createdAt: minutesAgo(19) }), NOW)).toBeNull();
    expect(lateMinutes(row({ createdAt: minutesAgo(25) }), NOW)).toBe(5);
    expect(lateMinutes(row({ status: 'READY', createdAt: minutesAgo(90), readyAt: minutesAgo(8) }), NOW)).toBeNull();
    expect(lateMinutes(row({ status: 'READY', readyAt: minutesAgo(14) }), NOW)).toBe(4);
    expect(lateMinutes(row({ status: 'ON_ROUTE', dispatchedAt: minutesAgo(45) }), NOW)).toBe(15);
    expect(lateMinutes(row({ status: 'DELIVERED', deliveredAt: minutesAgo(500) }), NOW)).toBeNull();
  });

  it('sonraki adım iş akışı sırasındadır', () => {
    expect(nextStatus(row({}))).toBe('READY');
    expect(nextStatus(row({ status: 'READY' }))).toBe('ON_ROUTE');
    expect(nextStatus(row({ status: 'ON_ROUTE' }))).toBe('DELIVERED');
    expect(nextStatus(row({ status: 'DELIVERED' }))).toBeNull();
    expect(nextStatus(row({ status: 'CANCELLED' }))).toBeNull();
  });

  it('mutabakat bekleyen yalnız o kuryenin teslim edilmiş kapıda tahsilatlı siparişleridir', () => {
    const rows = [
      row({ id: 'a', courierId: 'k1', status: 'DELIVERED', totalCents: 700 }),
      row({ id: 'b', courierId: 'k1', status: 'DELIVERED', paymentMethod: 'CARD', totalCents: 300 }),
      row({ id: 'c', courierId: 'k1', status: 'DELIVERED', paymentMethod: 'ONLINE' }),
      row({ id: 'd', courierId: 'k1', status: 'DELIVERED', settledAt: minutesAgo(1) }),
      row({ id: 'e', courierId: 'k1', status: 'ON_ROUTE' }),
      row({ id: 'f', courierId: 'k2', status: 'DELIVERED' }),
    ];
    const waiting = awaitingSettlement(rows, 'k1');
    expect(waiting.map((item) => item.id)).toEqual(['a', 'b']);
    expect(settlementTotals(waiting)).toEqual({ cashCents: 700, cardCents: 300 });
  });

  it('sepet toplamı tamsayı kuruştur ve kalem sözleşmesi fiyat taşımaz', () => {
    const lines = [
      { productId: 'prd_1', name: 'Çay', unitPriceCents: 1050, quantity: 3, note: '' },
      { productId: 'prd_2', name: 'Tost', unitPriceCents: 3000, quantity: 1, note: ' az pişmiş ' },
    ];
    expect(cartSubtotalCents(lines)).toBe(6150);
    const wire = toSubmitLines(lines);
    expect(wire[1].note).toBe('az pişmiş');
    expect(wire[0].note).toBeNull();
    expect(JSON.stringify(wire)).not.toContain('1050');
  });

  it('süre, telefon ve kod biçimleri', () => {
    expect(durationText(7)).toBe('7 dk');
    expect(durationText(65)).toBe('1 sa 05 dk');
    expect(phoneText('05321112233')).toBe('0532 111 22 33');
    expect(phoneText('123')).toBe('123');
    expect(orderCode('dlv_0123456789abcdef0123ab12')).toBe('AB12');
  });
});
