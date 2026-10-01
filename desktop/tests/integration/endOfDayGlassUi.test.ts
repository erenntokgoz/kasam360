/**
 * Gün Sonu & Kasa Kapanış Ekranı — macOS Frosted Glass UI Entegrasyon Test Paketi
 * Path: tests/integration/endOfDayGlassUi.test.ts
 *
 * AGENTS.md anayasasına uygun olarak EndOfDayContainer bileşeninin:
 * 1. macOS Frosted Glass (backdrop-blur-xl bg-zinc-900/40 border border-white/10) tasarımını,
 * 2. 4 Finansal Skor Kartını (Günlük Net Ciro, Nakit Kasası, Kredi Kartı / POS, Toplam Adisyon),
 * 3. Kasa Sayım & Vardiya Takibini ve kasa farkı durumunu (Yeşil: Eşleşti / Turuncu: Fark Var),
 * 4. Ödeme Dağılımını ve orantılı görsel dağılım barını,
 * 5. Tek ve Güvenli "Günü Kapat" aksiyon panelini ve açık masa kontrolünü,
 * 6. 2 Net Görünüm Sekmesini ("Bugünkü Gün Sonu" ve "Geçmiş Z-Raporları Arşivi") doğrular.
 */


import React from 'react';
import {
  EndOfDayContainer,
  DailySummaryDto,
  OpenShiftDto,
  ShiftHistoryDto,
  CloseDayResultDto,
} from '../../src/presentation/components/endofday/EndOfDayContainer';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

describe('Milestone 6: Gün Sonu & Kasa Kapanış — Dengeli Glass UX & Finansal Raporlama', () => {
  it('1. EndOfDayContainer fonksiyonel bileşeni tanımlıdır ve React elementi olarak örneklenebilir', () => {
    const element = React.createElement(EndOfDayContainer);
    expect(element).toBeDefined();
    expect(EndOfDayContainer).toBeInstanceOf(Function);
  });

  it('2. DTO veri modelleri ve sözleşmeleri AGENTS.md tamsayı kuruş (cents) standardına uygundur', () => {
    const mockDailySummary: DailySummaryDto = {
      total_revenue_cents: 185000, // 1,850.00 TL
      total_orders: 24,
      payment_methods: {
        Nakit: 75000,
        'Kredi Kartı': 110000,
      },
    };

    expect(mockDailySummary.total_revenue_cents).toBe(185000);
    expect(mockDailySummary.total_orders).toBe(24);
    expect(mockDailySummary.payment_methods['Nakit']).toBe(75000);
  });

  it('3. Vardiya modelleri açılış, beklenen ve sayılan kasa alanlarını eksiksiz destekler', () => {
    const mockOpenShift: OpenShiftDto = {
      id: 'shift_open_01',
      cashierName: 'Ali Kasiyer',
      openedAt: new Date().toISOString(),
      expected_amount_cents: 50000,
    };

    const mockClosedShift: ShiftHistoryDto = {
      id: 'shift_closed_01',
      cashierName: 'Veli Kasiyer',
      status: 'CLOSED',
      openedAt: new Date(Date.now() - 36000000).toISOString(),
      closedAt: new Date().toISOString(),
      expectedAmountCents: 120000,
      actualAmountCents: 120000,
      differenceCents: 0,
    };

    expect(mockOpenShift.expected_amount_cents).toBe(50000);
    expect(mockClosedShift.differenceCents).toBe(0);
    expect(mockClosedShift.status).toBe('CLOSED');
  });

  it('4. Kapanış işlemi (close_day) yanıtı Z-Raporu ve ciro özetini eksiksiz döner', async () => {
    const res = await tauriInvoke<CloseDayResultDto>('close_day', {
      actorRole: 'MANAGER',
      actorId: 'usr_manager',
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.message).toBeDefined();
    expect(typeof res.totalRevenueCents).toBe('number');
  });

  it('5. Günlük özet sorgusu (get_daily_summary) ciro ve ödeme dağılımını döner', async () => {
    const summary = await tauriInvoke<DailySummaryDto>('get_daily_summary', {
      actorRole: 'OWNER',
    });

    expect(summary).toBeDefined();
    expect(typeof summary.total_revenue_cents).toBe('number');
    expect(typeof summary.total_orders).toBe('number');
    expect(summary.payment_methods).toBeDefined();
  });

  it('6. Geçmiş vardiya listesi (get_shift_history) kapanan vardiyaları listeler', async () => {
    const history = await tauriInvoke<ShiftHistoryDto[]>('get_shift_history', {
      cashierId: 'ALL',
    });

    expect(Array.isArray(history)).toBe(true);
  });

  it('7. Açık masa kontrolü (get_floor_plan) güvenli kapanış uyarısı için masa listesini sağlar', async () => {
    const floorPlan = await tauriInvoke<any[]>('get_floor_plan', {
      tenantId: 'DEFAULT_TENANT',
    });

    expect(Array.isArray(floorPlan)).toBe(true);
  });

  it('8. EndOfDayContainer bileşeni #060609 zemin rengi ve Apple dual-theme (dark:bg-[#060609] bg-[#f5f5f7]) sınıflarını içerir', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer));
    expect(html).toBeDefined();
    // Sayfa zemin rengi standartları
    expect(html).toContain('dark:bg-[#060609]');
    expect(html).toContain('bg-[#f5f5f7]');
    expect(html).toContain('dark:text-white');
    expect(html).toContain('text-zinc-900');
  });

  it('9. Üstte 4 net Skor Kartı doğru etiketlerle ve renksiz şeffaf cam stilinde mevcuttur', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer));

    // 4 Skor Kartı Başlıkları
    expect(html).toContain('Günlük Net Ciro');
    expect(html).toContain('Fiziki Nakit Kasa');
    expect(html).toContain('Kredi Kartı / POS');
    expect(html).toContain('Toplam Adisyon Sayısı');

    // Renksiz şeffaf cam sınıf standardı
    expect(html).toContain('dark:bg-white/[0.04]');
    expect(html).toContain('bg-white/75');
    expect(html).toContain('backdrop-blur-xl');
    expect(html).toContain('dark:border-white/10');
    expect(html).toContain('border-black/[0.08]');
    expect(html).toContain('shadow-xl');
  });

  it('10. 2 Net Görünüm Sekmesi Apple Segmented Control tarzında mevcuttur', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer));

    expect(html).toContain('Bugünkü Gün Sonu');
    expect(html).toContain('Geçmiş Z-Raporları Arşivi');
    expect(html).toContain('Günün Defteri');
    expect(html).toContain('Geçmiş Defter Kayıtları');
  });

  it('11. Kasiyer Kasa Takibi, kasa mutabakatı ve güvenli tek kapatma paneli mevcuttur', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer, {
      initialOpenShifts: [
        {
          id: 'shift_test_1',
          cashierName: 'Ali Kasiyer',
          openedAt: new Date().toISOString(),
          expected_amount_cents: 50000,
        },
      ],
      initialShiftHistory: [
        {
          id: 'shift_hist_1',
          cashierName: 'Veli Kasiyer',
          status: 'CLOSED',
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
          expectedAmountCents: 60000,
          actualAmountCents: 60000,
          differenceCents: 0,
        },
      ],
    }));

    // Kasa & Vardiya Çizelgesi ve Kasiyer Kasa Takibi
    expect(html).toContain('Hesap Defteri');
    expect(html).toContain('Vardiya Çizelgesi');
    expect(html).toContain('Kasiyer Kasa Takibi');
    expect(html).toContain('Kasa Farkı Uyarısı');
    expect(html).toContain('Kasa Denk');
    expect(html).toContain('Denk');

    // Günün Defter Kapanışı ve Tek Güvenli Kapanış Paneli
    expect(html).toContain('Günün Defter Kapanışı (Mühürleme)');
    expect(html).toContain('Güvenli Gün Sonu Kapanışı');
    expect(html).toContain('Günü Kapat ve Z-Raporu Üret');
  });

  it('12. Sıfır ciro ve sıfır veri durumunda bileşen hatasız render edilir', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer));
    expect(html).toBeDefined();
    // Sıfır veri durumunda çökme veya NaN oluşmamalıdır
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('13. Kasa mutabakatında fark varsa Turuncu (Fark Var / Açık) uyarısı görüntülenir', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(React.createElement(EndOfDayContainer, {
      initialShiftHistory: [
        {
          id: 'shift_diff_1',
          cashierName: 'Zeynep Kasiyer',
          status: 'CLOSED',
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
          expectedAmountCents: 100000,
          actualAmountCents: 95000,
          differenceCents: -5000,
        },
      ],
    }));

    expect(html).toContain('Fark Var');
    expect(html).toContain('Açık');
    expect(html).toContain('bg-amber-500/15');
  });
});

