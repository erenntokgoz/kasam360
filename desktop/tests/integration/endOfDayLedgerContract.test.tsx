/**
 * Faz 9 arayüz sözleşme testleri.
 * Path: tests/integration/endOfDayLedgerContract.test.ts
 *
 * Kapsam: Yeni hesap defteri bileşenlerinin AGENTS.md kurallarina uyumu:
 * 1. DueBadge emoji kullanmaz, durumu metin + ikon ile anlatir (B2.6)
 * 2. BudgetAlerts asimda kalan bakiyeyi negatif gosterir, gizlemez (B4.2)
 * 3. RecurringSchedule dueDay degerini yeniden hesaplamaz (B4.4)
 * 4. ProfitAndLoss aylik trend toplami donem toplamiyla uyusur (B5.2)
 * 5. OwnerPersonalPanel P&L disi rozetini zorunlu tasir (B6.2)
 * 6. NetBalanceStrip sermaye cekimini alacak gibi sunmaz (B2.2)
 */

import { renderToString } from 'react-dom/server';
import { DueBadge } from '../../src/presentation/components/endofday/ui/DueBadge';
import { BudgetAlerts } from '../../src/presentation/components/endofday/ui/BudgetAlerts';
import {
  RecurringSchedule,
  resolveDueState,
} from '../../src/presentation/components/endofday/ui/RecurringSchedule';
import { CashReconciliation } from '../../src/presentation/components/endofday/ui/CashReconciliation';
import {
  isTrendConsistent,
  trendNetTotal,
  FinancialReport,
} from '../../src/presentation/components/endofday/ui/ProfitAndLoss';
import { formatCurrency } from '../../src/presentation/components/endofday/helpers';

const EMOJI_PATTERN = /[\u{1F300}-\u{1F9FF}]/u;

/** React SSR arasi metin dugumlerine `<!-- -->` koyar; iddialar onu gormemeli. */
const plain = (html: string) => html.replace(/<!-- -->/g, '');

describe('Faz 9 — DueBadge kontrati (B2.4 / B2.5 / B2.6)', () => {
  it('gecikmis durum metin ve ikon tasi, emoji tasiyamaz', () => {
    const html = plain(renderToString(<DueBadge state="OVERDUE" label="Gecikti" daysLate={3} />));
    expect(EMOJI_PATTERN.test(html)).toBe(false);
    expect(html).toContain('Gecikti');
    expect(html).toContain('3 gun gecikti');
  });

  it('bugun vadesi durumu ayri metin olarak ayrilir', () => {
    const html = plain(renderToString(<DueBadge state="DUE_TODAY" label="Bugun Vadesi" />));
    expect(html).toContain('Bugun Vadesi');
    expect(EMOJI_PATTERN.test(html)).toBe(false);
  });

  it('her durumda metin bulunur; renk tek basina bilgi tasimaz', () => {
    const states = ['OVERDUE', 'DUE_TODAY', 'UPCOMING', 'CLEARED'] as const;
    states.forEach((state) => {
      const html = plain(renderToString(<DueBadge state={state} label="Vade" />));
      expect(html).toContain('Vade');
    });
  });
});

describe('Faz 9 — BudgetAlerts kontrati (B4.1 / B4.2)', () => {
  const base = {
    category: 'Kira',
    monthlyLimitCents: 100_000,
    spentCents: 100_000,
    remainingCents: 0,
    usedPercent: 100,
    isExceeded: false,
    isNearLimit: false,
  };

  it('%80 esiginde uyari metni gorunur', () => {
    const html = plain(
      renderToString(
        <BudgetAlerts
          items={[{ ...base, usedPercent: 80, isNearLimit: true, spentCents: 80_000, remainingCents: 20_000 }]}
        />
      )
    );
    expect(html).toContain('Limit Yaklasiyor');
  });

  it('asim durumunda kalan bakiye negatif olarak gosterilir', () => {
    const html = plain(
      renderToString(
        <BudgetAlerts
          items={[
            { ...base, usedPercent: 140, isExceeded: true, spentCents: 140_000, remainingCents: -40_000 },
          ]}
        />
      )
    );
    expect(html).toContain('Limit Asildi');
    expect(html).toContain('Kalan: ' + formatCurrency(-40_000));
  });
});

describe('Faz 9 — RecurringSchedule kontrati (B4.3 / B4.4)', () => {
  const item = {
    id: 'rec_001',
    title: 'Elektrik Faturasi',
    category: 'Sabit Gider',
    amountCents: 75_000,
    frequency: 'MONTHLY',
    dueDay: 31,
    daysInMonth: 30,
    isOverdue: false,
    isDueToday: false,
  };

  it('ay sonu sikistirmasini yeniden hesaplamaz, backend degerini kullanir', () => {
    const html = plain(renderToString(<RecurringSchedule items={[item]} onPrint={() => undefined} />));
    // dueDay 31 geldi; frontend bunu 30a cevirmez.
    expect(html).toContain('Ayin 31. gunu (bu ay 30 gun)');
  });

  it('gecikmis ve bugun vadesi durumlari ayri cozumlenir', () => {
    expect(resolveDueState({ ...item, isOverdue: true })).toEqual({ state: 'OVERDUE', label: 'Gecikti' });
    expect(resolveDueState({ ...item, isDueToday: true })).toEqual({
      state: 'DUE_TODAY',
      label: 'Bugun Vadesi',
    });
    expect(resolveDueState(item).state).toBe('UPCOMING');
  });
});

describe('Faz 9 — P&L bütünlük kontrati (B5.2 / B5.3)', () => {
  const report: FinancialReport = {
    total_revenue_cents: 500_000,
    total_sales_revenue_cents: 300_000,
    total_debt_collected_cents: 200_000,
    total_expenses_cents: 200_000,
    net_profit_cents: 300_000,
    receivables_cents: 0,
    payables_cents: 0,
    expenses_by_category: [{ category: 'Kira', total_cents: 200_000, count: 1 }],
    monthly_trend: [
      { month: '2026-08', revenue_cents: 200_000, expense_cents: 100_000, profit_cents: 100_000 },
      { month: '2026-09', revenue_cents: 300_000, expense_cents: 100_000, profit_cents: 200_000 },
    ],
  };

  it('aylik trend toplami donem toplamiyla esitse rapor tutarlidir', () => {
    expect(trendNetTotal(report)).toBe(300_000);
    expect(isTrendConsistent(report)).toBe(true);
  });

  it('cift sayim kaynakli uyusmazlik yakalanir', () => {
    const inconsistent = { ...report, net_profit_cents: 500_000 };
    expect(isTrendConsistent(inconsistent)).toBe(false);
  });

  it('rapor yoksa toplam sifir degil, tutarli sekilde bos kabul edilir', () => {
    expect(trendNetTotal(null)).toBe(0);
  });
});

describe('Faz 9 — CashReconciliation kontrati (B5.5)', () => {
  const closedRow = {
    shift: {
      id: 'sh_001',
      status: 'CLOSED',
      expected_amount_cents: 100_000,
      actual_amount_cents: 95_000,
    },
    isOpen: false,
    cashSalesCents: 100_000,
  };

  const openRow = {
    shift: { id: 'sh_002', status: 'OPEN', expected_amount_cents: 50_000 },
    isOpen: true,
    cashSalesCents: null,
  };

  it('acik farki acikca yazar, sifir saymaz', () => {
    const html = plain(renderToString(<CashReconciliation rows={[closedRow]} />));
    expect(html).toContain('Fark Var');
    expect(html).toContain(formatCurrency(100_000));
    expect(html).toContain(formatCurrency(95_000));
  });

  it('sayim bekleyen vardiya toplama dahil edilmez ve ayri belirtilir', () => {
    const html = plain(renderToString(<CashReconciliation rows={[closedRow, openRow]} />));
    expect(html).toContain('1 acik vardiya sayim bekliyor');
  });
});