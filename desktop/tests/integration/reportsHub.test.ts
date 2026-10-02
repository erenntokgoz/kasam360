/**
 * Birleşik rapor merkezi testleri (Faz 5).
 *
 * Kapsam:
 * 1. Tarih aralığı yardımcıları (yerel gün sınırları, ters aralık reddi).
 * 2. Dışa aktarma çekirdeği (Türkçe para, CSV kaçışı, Excel ayracı, dosya adı).
 * 3. Komut kapıları: rol, tenant ve aralık zorunluluğu + tenant izolasyonu.
 *
 * Neden kapı testleri önemli: rapor merkezinin tüm güvenliği bu üç
 * parametreye bağlı. Sınırsız (tüm zamanlar) ya da tenantsız bir aralık,
 * işletme sahibinin kendi verisini değil tüm veritabanını dökmek demektir.
 */

import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import {
  ADJUSTMENT_KIND_LABELS,
  AdjustmentsReport,
  ReceiptReportRow,
  ReportRange,
  SalesReport,
  ShiftReportRow,
  buildPresetRange,
  fromDateInput,
  paymentMethodLabel,
  rangeDayCount,
  toDateInputValue,
} from '../../src/presentation/components/reports/reportTypes';
import {
  buildCsvBody,
  buildReportFileName,
  centsToExportString,
  escapeCsvCell,
  toTurkishDate,
  toTurkishDateTime,
} from '../../src/presentation/components/reports/export/reportExport';

const TENANT = 'DEFAULT_TENANT';

function validRange(): ReportRange {
  return buildPresetRange('last30');
}

describe('Rapor tarih aralığı', () => {
  it('bugün aralığı yerel gün başı ve gün sonu ile sınırlanır', () => {
    const range = buildPresetRange('today');
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(Date.parse(range.from)).toBeLessThanOrEqual(Date.parse(range.to));
  });

  it('son 7 gün aralığı yedi gün kapsar', () => {
    expect(rangeDayCount(buildPresetRange('last7'))).toBe(7);
    expect(rangeDayCount(buildPresetRange('last30'))).toBe(30);
  });

  it('ters aralık reddedilir, eksik tarih reddedilir', () => {
    const reversed = fromDateInput('2026-02-10', '2026-02-01');
    expect('error' in reversed).toBe(true);
    const missing = fromDateInput('', '2026-02-01');
    expect('error' in missing).toBe(true);
  });

  it('geçerli tarih girdisi gün başı ve gün sonu ISO değerine çevrilir', () => {
    const result = fromDateInput('2026-01-01', '2026-01-31');
    if ('error' in result) throw new Error('aralık kabul edilmeliydi');
    expect(toDateInputValue(result.from)).toBe('2026-01-01');
    expect(toDateInputValue(result.to)).toBe('2026-01-31');
    expect(rangeDayCount(result)).toBe(31);
  });

  it('ödeme yöntemi etiketleri Türkçeye çevrilir, bilinmeyen kod olduğu gibi kalır', () => {
    expect(paymentMethodLabel('CASH')).toBe('Nakit');
    expect(paymentMethodLabel('CREDIT_CARD')).toBe('Kredi Kartı');
    expect(paymentMethodLabel('SPLIT')).toBe('Parçalı Ödeme');
    expect(paymentMethodLabel('BANK_TRANSFER')).toBe('Banka Havalesi');
    expect(paymentMethodLabel('KREDI_PRE')).toBe('KREDI_PRE');
  });
});

describe('Rapor dışa aktarma çekirdeği', () => {
  it('kuruş Türkçe para biçimine çevrilir', () => {
    expect(centsToExportString(1234)).toBe('12,34');
    expect(centsToExportString(0)).toBe('0,00');
  });

  it('ayraç, tırnak ve satır sonu kaçışları uygulanır', () => {
    expect(escapeCsvCell('adam;kayma', ';')).toBe('"adam;kayma"');
    expect(escapeCsvCell('tırnak "işareti"', ',')).toBe('"tırnak ""işareti"""');
    expect(escapeCsvCell('satır\nsonu', ',')).toContain('"');
    expect(escapeCsvCell('düz', ',')).toBe('düz');
  });

  it('Excel için noktalı virgül ayraç kullanılır', () => {
    const columns = [
      { header: 'Fiş', value: (row: { id: string }) => row.id },
      { header: 'Tutar', value: () => '12,34' },
    ];
    const csv = buildCsvBody(columns, [{ id: 'ord_1' }], false);
    expect(csv.split('\r\n')[0]).toBe('Fiş,Tutar');

    const excel = buildCsvBody(columns, [{ id: 'ord_1' }], true);
    expect(excel.split('\r\n')[0]).toBe('Fiş;Tutar');
    expect(excel.split('\r\n')[1]).toBe('ord_1;12,34');
  });

  it('dosya adı tarih damgalıdır', () => {
    const name = buildReportFileName('satis', 'csv', new Date('2026-10-02T10:00:00Z'));
    expect(name).toBe('kasam360_satis_2026-10-02.csv');
  });

  it('tarih dönüşümleri okunamayan girdide girdiyi döndürür', () => {
    expect(toTurkishDate('2026-10-02T10:00:00Z')).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(toTurkishDateTime('bozuk')).toBe('bozuk');
  });
});

describe('Rapor komutlarının kapıları', () => {
  it('satış raporu rol, tenant ve aralık olmadan okunamaz', async () => {
    const range = validRange();
    await expect(
      tauriInvoke<SalesReport>('get_sales_report', { from: range.from, to: range.to }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    await expect(
      tauriInvoke<SalesReport>('get_sales_report', {
        callerRole: 'OWNER',
        from: range.from,
        to: range.to,
      }),
    ).rejects.toThrow(/tenant_id/);

    await expect(
      tauriInvoke<SalesReport>('get_sales_report', {
        callerRole: 'OWNER',
        tenantId: TENANT,
      }),
    ).rejects.toThrow(/from is required/);
  });

  it('kasiyer ve MASTER rapor merkezine giremez', async () => {
    const range = validRange();
    for (const role of ['CASHIER', 'MASTER']) {
      await expect(
        tauriInvoke<SalesReport>('get_sales_report', {
          callerRole: role,
          tenantId: TENANT,
          from: range.from,
          to: range.to,
        }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    }
  });

  it('ters tarih aralığı reddedilir', async () => {
    await expect(
      tauriInvoke<SalesReport>('get_sales_report', {
        callerRole: 'MANAGER',
        tenantId: TENANT,
        from: '2026-02-10T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/to must not be before from/);
  });

  it('satış raporu kuruş alanlarını ve aralığı döndürür', async () => {
    const range = validRange();
    const report = await tauriInvoke<SalesReport>('get_sales_report', {
      callerRole: 'OWNER',
      tenantId: TENANT,
      from: range.from,
      to: range.to,
    });
    expect(typeof report.total_revenue_cents).toBe('number');
    expect(typeof report.total_orders).toBe('number');
    expect(report.from).toBe(range.from);
    expect(report.to).toBe(range.to);
    // Uydurma dağılım yok: liste ya gerçek satırlardan gelir ya boştur.
    expect(Array.isArray(report.payment_methods)).toBe(true);
    expect(Array.isArray(report.category_volume)).toBe(true);
  });

  it('başka tenant verisi rapora girmez', async () => {
    const range = validRange();
    const own = await tauriInvoke<SalesReport>('get_sales_report', {
      callerRole: 'OWNER',
      tenantId: TENANT,
      from: range.from,
      to: range.to,
    });
    const other = await tauriInvoke<SalesReport>('get_sales_report', {
      callerRole: 'OWNER',
      tenantId: 'BASKA_TENANT',
      from: range.from,
      to: range.to,
    });
    expect(other.total_orders).toBe(0);
    expect(other.total_revenue_cents).toBe(0);
    expect(own.total_orders).toBeGreaterThanOrEqual(0);
  });

  it('vardiya ve fiş raporları kapsam ve limit uygular', async () => {
    const range = validRange();
    const shifts = await tauriInvoke<ShiftReportRow[]>('get_shift_report', {
      callerRole: 'OWNER',
      tenantId: TENANT,
      from: range.from,
      to: range.to,
      limit: 2,
    });
    expect(Array.isArray(shifts)).toBe(true);
    expect(shifts.length).toBeLessThanOrEqual(2);

    const receipts = await tauriInvoke<ReceiptReportRow[]>('get_receipts_report', {
      callerRole: 'OWNER',
      tenantId: TENANT,
      from: range.from,
      to: range.to,
      limit: 5,
    });
    expect(Array.isArray(receipts)).toBe(true);
    expect(receipts.length).toBeLessThanOrEqual(5);
  });

  it('iptal raporu kaydı bulunmayan hareket türlerini açıkça bildirir', async () => {
    const range = buildPresetRange('last30');
    const report = await tauriInvoke<AdjustmentsReport>('get_adjustments_report', {
      callerRole: 'OWNER',
      tenantId: TENANT,
      from: range.from,
      to: range.to,
    });
    expect(Array.isArray(report.rows)).toBe(true);
    expect(Array.isArray(report.kinds_without_records)).toBe(true);
    // Kayıt yoksa tür "kayıt yok" listesinde olmalı; sıfır tutar satır üretilmez.
    for (const row of report.rows) {
      expect(ADJUSTMENT_KIND_LABELS[row.kind]).toBeDefined();
      expect(typeof row.amount_cents).toBe('number');
      expect(typeof row.approver_id).toBe('string');
    }
  });
});
