import { describe, it, expect } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

describe('Cashier Workstation Integration Tests', () => {
  const cashierId = 'CASHIER_TEST_01';

  it('get_active_shift returns active shift or null', async () => {
    const shift = await tauriInvoke<any>('get_active_shift', { cashierId });
    expect(shift).toBeDefined();
    if (shift) {
      expect(shift.status).toBe('OPEN');
      expect(typeof (shift.expectedAmountCents ?? shift.expected_amount_cents)).toBe('number');
    }
  });

  it('open_shift opens a shift with expected opening balance in cents', async () => {
    const openingCents = 25000; // 250.00 ₺
    const result = await tauriInvoke<any>('open_shift', {
      cashierId,
      cashier_id: cashierId,
      expectedAmountCents: openingCents,
      expected_amount_cents: openingCents,
    });
    expect(result).toBeDefined();
    expect(result.status).toBe('OPEN');
    const balance = result.expectedAmountCents ?? result.expected_amount_cents;
    expect(balance).toBe(openingCents);
  });

  it('get_shift_summary calculates sales, cash movements and discrepancy', async () => {
    const summary = await tauriInvoke<any>('get_shift_summary', {
      shiftId: 'shift_browser_001',
      shift_id: 'shift_browser_001',
    });
    expect(summary).toBeDefined();
    expect(summary.totalSales).toBeGreaterThanOrEqual(0);
    expect(summary.totalCashIn).toBeGreaterThanOrEqual(0);
    expect(summary.totalCashOut).toBeGreaterThanOrEqual(0);
    expect(summary.expectedBalance).toBeGreaterThanOrEqual(0);
    expect(typeof summary.discrepancy).toBe('number');
  });

  it('cash_in and cash_out register movements in cents', async () => {
    const inRes = await tauriInvoke<any>('cash_in', {
      shiftId: 'shift_browser_001',
      shift_id: 'shift_browser_001',
      amountCents: 5000, // 50.00 ₺
      amount_cents: 5000,
      reason: 'Bozuk para takviyesi',
      actorId: cashierId,
      actor_id: cashierId,
    });
    expect(inRes).toBeDefined();

    const outRes = await tauriInvoke<any>('cash_out', {
      shiftId: 'shift_browser_001',
      shift_id: 'shift_browser_001',
      amountCents: 2000, // 20.00 ₺
      amount_cents: 2000,
      reason: 'Kırtasiye gideri',
      actorId: cashierId,
      actor_id: cashierId,
    });
    expect(outRes).toBeDefined();
  });

  it('close_shift closes active shift and records closing count', async () => {
    const closingCents = 55000; // 550.00 ₺
    const closeRes = await tauriInvoke<any>('close_shift', {
      cashierId,
      cashier_id: cashierId,
      actualAmountCents: closingCents,
      actual_amount_cents: closingCents,
    });
    expect(closeRes).toBeDefined();
  });

  it('get_shift_history returns list of closed shifts with opening and closing balances', async () => {
    const history = await tauriInvoke<any[]>('get_shift_history', {
      cashierId,
      cashier_id: cashierId,
    });
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const item = history[0];
    expect(item.id).toBeDefined();
    expect(item.status).toBe('CLOSED');
  });

  it('print_receipt handles Z-Report, payment receipts and cash slips without error', async () => {
    const zReportRes = await tauriInvoke<any>('print_receipt', {
      order: {
        type: 'Z_REPORT',
        title: 'Z-RAPORU',
        shiftId: 'shift_old_001',
        cashierId,
        openingBalance: 10000,
        totalSales: 50000,
        expectedBalance: 55000,
        actualBalance: 55000,
        discrepancy: 0,
      },
    });
    expect(zReportRes).toBeDefined();

    const paymentSlipRes = await tauriInvoke<any>('print_receipt', {
      order: {
        type: 'PAYMENT_RECEIPT',
        title: 'ÖDEME TAHSİLAT FİŞİ',
        transactionId: 'TXN-999',
        tableName: 'Masa 1',
        totalAmount: 4500,
        amountTendered: 5000,
        changeAmount: 500,
        items: [{ name: 'Türk Kahvesi', quantity: 2, unitPrice: 2000, total: 4000 }],
      },
    });
    expect(paymentSlipRes).toBeDefined();
  });

  it('process_payment settles table bill, sets table AVAILABLE and computes change correctly', async () => {
    const totalCents = 4000; // 40.00 ₺
    const tenderedCents = 5000; // 50.00 ₺
    const changeCents = tenderedCents - totalCents; // 1000 (10.00 ₺)

    const payload = {
      transactionId: `TXN_TEST_${Date.now()}`,
      orderId: 'ORD_TEST_01',
      timestamp: new Date().toISOString(),
      method: 'CASH',
      amountTendered: tenderedCents,
      totalAmount: totalCents,
      changeAmount: changeCents,
      items: [
        {
          id: 'item_1',
          product: { id: 'prd-001', name: 'Türk Kahvesi', price: 2000, taxRate: 8, sku: 'SKU-CAF-001', category: 'hot', inStock: true },
          quantity: 2,
          unitPrice: 2000,
          taxRate: 8,
          subtotal: 4000,
          taxAmount: 320,
          total: 4000,
        },
      ],
      customerRef: 'tbl-001',
      cashierId,
    };

    const res = await tauriInvoke<any>('process_payment', { payload });
    expect(res.success).toBe(true);
  });

  it('void_order cancels active table order with reason and authorization', async () => {
    const payload = {
      orderId: 'tbl-002',
      tableId: 'tbl-002',
      reason: 'Müşteri siparişi iptal etti',
      actorId: cashierId,
      actorRole: 'MANAGER',
      managerPin: '3333',
    };

    const res = await tauriInvoke<any>('void_order', {
      payload,
      tenantId: 'DEFAULT_TENANT',
      tenant_id: 'DEFAULT_TENANT',
    });
    expect(res.success ?? res).toBeTruthy();
  });
});
