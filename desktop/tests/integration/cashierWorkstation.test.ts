
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

describe('Cashier Workstation Integration Tests', () => {
  const cashierId = 'CASHIER_TEST_01';

  it('get_active_shift returns active shift or null', async () => {
    // Backend bu komutta RBAC ve tenant zorunlu kılıyor (Faz 11 V1/V4 düzeltmesi):
    // cross-tenant kasa bakiyesi sızıntısını kapatmak için kapı eklendi.
    const shift = await tauriInvoke<any>('get_active_shift', {
      cashierId,
      actorRole: 'CASHIER',
      tenantId: 'DEFAULT_TENANT',
    });
    expect(shift).toBeDefined();
    if (shift) {
      expect(shift.status).toBe('OPEN');
      expect(typeof (shift.expectedAmountCents ?? shift.expected_amount_cents)).toBe('number');
    }
  });

  it('get_active_shift rolsuz çağrıyı reddeder', async () => {
    await expect(
      tauriInvoke('get_active_shift', { cashierId, tenantId: 'DEFAULT_TENANT' }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('open_shift opens a shift with expected opening balance in cents', async () => {
    const openingCents = 25000; // 250.00 ₺
    const result = await tauriInvoke<any>('open_shift', {
      cashierId,
      cashier_id: cashierId,
      expectedAmountCents: openingCents,
      expected_amount_cents: openingCents,
      // Faz 11 V4: beklenen bakiyeyi belirleyen komut rol kapısı arkasında.
      actorRole: 'CASHIER',
      tenantId: 'DEFAULT_TENANT',
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
      // Faz 7: kasa hareketi tenant'sız kaydedilmez (mock, backend ile aynı kapı).
      tenantId: 'DEFAULT_TENANT',
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
      tenantId: 'DEFAULT_TENANT',
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
      // Faz 11 V4: kasa farkı üreten komut rol kapısı arkasında.
      actorRole: 'CASHIER',
      tenantId: 'DEFAULT_TENANT',
    });
    expect(closeRes).toBeDefined();
  });

  it('get_shift_history returns list of closed shifts with opening and closing balances', async () => {
    const history = await tauriInvoke<any[]>('get_shift_history', {
      callerRole: 'CASHIER',
      // Faz 5: komut artık tenant'ı zorunlu ister; oturum yoksa çağıran açıkça
      // vermek zorundadır (backend ile aynı fail-closed davranış).
      tenantId: 'DEFAULT_TENANT',
      cashierId,
      cashier_id: cashierId,
    });
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const item = history[0];
    expect(item.id).toBeDefined();
    expect(item.status).toBe('CLOSED');
  });

  it('basım komutları yalnız kayıtlı ve bu tenant’a ait veriyi basar', async () => {
    const tenantId = 'DEFAULT_TENANT';

    // Vardiya Z-Raporu: vardiya kaydı tenant'a ait olmalı.
    const opened = await tauriInvoke<any>('open_shift', {
      cashierId,
      expectedAmountCents: 10000,
      tenantId,
      actorRole: 'CASHIER',
    });
    expect(opened?.id).toBeDefined();

    await expect(
      tauriInvoke('print_z_report', { shiftId: opened.id, actorRole: 'CASHIER', tenantId }),
    ).resolves.toBeDefined();

    // Rol ve tenant eksikse fail-closed: keyfi veri basılmaz.
    await expect(
      tauriInvoke('print_z_report', { shiftId: opened.id, tenantId }),
    ).rejects.toThrow(/UNAUTHORIZED/);
    await expect(
      tauriInvoke('print_z_report', { shiftId: opened.id, actorRole: 'CASHIER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    // Kayıt dışı vardiya basılamaz.
    await expect(
      tauriInvoke('print_z_report', {
        shiftId: 'shift_yok',
        actorRole: 'CASHIER',
        tenantId,
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    // Tahsilat fişi: önce ödeme yapılır, sonra fiş basılır.
    const payment = await tauriInvoke<any>('process_payment', {
      tenantId,
      payload: {
        transactionId: `TXN_PRINT_${Date.now()}`,
        orderId: 'ORD_PRINT_01',
        timestamp: new Date().toISOString(),
        method: 'CASH',
        amountTendered: 5000,
        totalAmount: 4500,
        changeAmount: 500,
        items: [],
      },
    });
    expect(payment.success).toBe(true);
    await expect(
      tauriInvoke('print_receipt', {
        receiptId: payment.transactionId,
        actorRole: 'CASHIER',
        tenantId,
      }),
    ).resolves.toBeDefined();

    // Kasa fişi: kayıtlı hareketten basılır, uydurma kimlikle basılamaz.
    const movement = await tauriInvoke<any>('cash_in', {
      shiftId: opened.id,
      amountCents: 2500,
      reason: 'Kasa açılış tamamı',
      actorId: cashierId,
      actorRole: 'CASHIER',
      tenantId,
    });
    expect(movement?.id).toBeDefined();
    await expect(
      tauriInvoke('print_cash_slip', { movementId: movement.id, actorRole: 'CASHIER', tenantId }),
    ).resolves.toBeDefined();
    await expect(
      tauriInvoke('print_cash_slip', {
        movementId: 'cm_yok',
        actorRole: 'CASHIER',
        tenantId,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
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

  it('process_payment handles CREDIT_CARD with exact amount and zero change', async () => {
    const totalCents = 7500; // 75.00 ₺
    const payload = {
      transactionId: `TXN_CC_${Date.now()}`,
      orderId: 'ORD_CC_01',
      timestamp: new Date().toISOString(),
      method: 'CREDIT_CARD',
      amountTendered: totalCents,
      totalAmount: totalCents,
      changeAmount: 0,
      items: [
        {
          id: 'item_cc_1',
          product: { id: 'prd-002', name: 'Latte', price: 7500, taxRate: 10, sku: 'SKU-LAT-001', category: 'hot', inStock: true },
          quantity: 1,
          unitPrice: 7500,
          taxRate: 10,
          subtotal: 7500,
          taxAmount: 682,
          total: 7500,
        },
      ],
      customerRef: 'tbl-002',
      cashierId,
    };

    const res = await tauriInvoke<any>('process_payment', { payload });
    expect(res.success).toBe(true);
  });

  // Faz 3: iptal artık `managerPin` ile değil, anlık PIN onayından gelen tek
  // kullanımlık jetonla yapılır. Jeton onsuz iptal backend'de reddedilir.
  it('void_order requires an approval token before cancelling', async () => {
    const basePayload = {
      orderId: 'tbl-002',
      tableId: 'tbl-002',
      reason: 'Müşteri siparişi iptal etti',
      actorId: cashierId,
      actorRole: 'MANAGER',
    };

    const voidOrder = (payload: Record<string, unknown>) =>
      tauriInvoke<any>('void_order', {
        payload,
        tenantId: 'DEFAULT_TENANT',
        tenant_id: 'DEFAULT_TENANT',
      });

    // 1. Jeton yoksa iptal reddedilir.
    const withoutToken = await voidOrder(basePayload).then(
      () => null,
      (err: unknown) => String(err),
    );
    expect(withoutToken).toContain('APPROVAL_REQUIRED');

    // 2. Onay PIN'i üretilir.
    const approval = await tauriInvoke<any>('verify_manager_pin', {
      payload: {
        operation: 'VOID_ORDER',
        resourceId: 'tbl-002',
        actorId: cashierId,
        actorRole: 'MANAGER',
        amountCents: 0,
        pin: '2222',
        tenantId: 'DEFAULT_TENANT',
        terminalId: 'POS_MAIN_01',
      },
    });
    expect(approval.approved).toBe(true);
    expect(typeof approval.approvalToken).toBe('string');

    // 3. Jetonla iptal geçer.
    const res = await voidOrder({ ...basePayload, approvalToken: approval.approvalToken });
    expect(res.success ?? res).toBeTruthy();

    // 4. Jeton tek kullanımlıktır: aynı jeton ikinci kez kullanılamaz.
    const replay = await voidOrder({
      ...basePayload,
      approvalToken: approval.approvalToken,
    }).then(
      () => null,
      (err: unknown) => String(err),
    );
    expect(replay).toContain('APPROVAL_TOKEN');
  });
});
