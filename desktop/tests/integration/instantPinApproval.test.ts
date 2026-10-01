/**
 * Anlık PIN onay servisi ve tarayıcı mock kuralları (Faz 3).
 *
 * Buradaki testler iki şeyi kanıtlar:
 * 1. Servis hata kodlarını kullanıcı metnine çevirir ve PIN'i dışarı sızdırmaz.
 * 2. Tarayıcı mock'u backend ile **aynı** kuralları uygular: her indirim onay
 *    ister, kasa onaylayamaz, self-approval reddedilir, jeton tek kullanımlıktır.
 */

import {
  APPROVAL_ERROR,
  APPROVAL_OPERATIONS,
  ApprovalError,
  describeRemainingAttempts,
  parseApprovalErrorCode,
  toUserFacingMessage,
} from '../../src/core/services/approvalService';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

/** Beklenen hata kodunu yakalar; hata yoksa `null` döner. */
async function captureError(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (err: unknown) => parseApprovalErrorCode(err),
  );
}

const VOID_REQUEST = {
  operation: 'VOID_ORDER' as const,
  resourceId: 'tbl-001',
  actorId: 'CASHIER_01',
  actorRole: 'CASHIER',
  amountCents: 5000,
  tenantId: 'DEFAULT_TENANT',
  terminalId: 'POS_MAIN_01',
};

/** Onay isteği alanları backend ile aynı: eksik alan sunucuda reddedilir. */
describe('Anlık PIN onay sözleşmesi', () => {
  it('işlem yüzeyleri backend ile aynı üç değerle sınırlıdır', () => {
    expect(Object.values(APPROVAL_OPERATIONS).sort()).toEqual([
      'COMPLIMENTARY',
      'DISCOUNT',
      'VOID_ORDER',
    ].sort());
  });

  it('onay isteği işlemi yapan kişiyi kendisi taşır', () => {
    expect(VOID_REQUEST.actorId).toBe('CASHIER_01');
    expect(VOID_REQUEST.actorRole).toBe('CASHIER');
  });
});

describe('Anlık PIN onay servisi', () => {
  it('hata kodlarını kullanıcı metnine çevirir', () => {
    expect(toUserFacingMessage(APPROVAL_ERROR.INVALID_PIN)).toBe('Onay PIN\'i hatalı.');
    expect(toUserFacingMessage(APPROVAL_ERROR.SELF_APPROVAL)).toBe(
      'Kendi işlemini onaylayamazsın.',
    );
    expect(toUserFacingMessage(APPROVAL_ERROR.LOCKED)).toContain('kilitli');
    expect(toUserFacingMessage(APPROVAL_ERROR.TOKEN_EXPIRED)).toContain('tekrar onay');
    expect(toUserFacingMessage(null)).toBe('Onay doğrulanamadı.');
  });

  it('sunucu hata metninden kodu ayıklar', () => {
    expect(parseApprovalErrorCode('INVALID_APPROVAL_PIN: Onay PIN\'i hatalı.')).toBe(
      APPROVAL_ERROR.INVALID_PIN,
    );
    expect(
      parseApprovalErrorCode('UNAUTHORIZED: Bu rol onay veremez (izin: MASTER, OWNER, MANAGER).'),
    ).toBe('UNAUTHORIZED');
    expect(parseApprovalErrorCode('APPROVAL_TOKEN_USED: Onay jetonu zaten kullanılmış.')).toBe(
      APPROVAL_ERROR.TOKEN_USED,
    );
    expect(parseApprovalErrorCode('Bilinmeyen hata')).toBeNull();
  });

  it('kalan deneme hakkını yalnız hak düştüğünde gösterir', () => {
    expect(describeRemainingAttempts(null)).toBeNull();
    expect(describeRemainingAttempts(5)).toBeNull();
    expect(describeRemainingAttempts(3)).toBe('3 deneme hakkın kaldı.');
    expect(describeRemainingAttempts(0)).toBe('Deneme hakkın kalmadı.');
  });

  it('ApprovalError PIN değerini taşımaz', () => {
    const error = new ApprovalError('Onay PIN\'i hatalı.', APPROVAL_ERROR.INVALID_PIN, 3);
    expect(error.message).not.toContain('2222');
    expect(error.remainingAttempts).toBe(3);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('Tarayıcı mock onay kuralları', () => {
  const approvalPayload = (pin: string, overrides: Record<string, unknown> = {}) => ({
    operation: 'VOID_ORDER',
    resourceId: 'tbl-mock-01',
    actorId: 'CASHIER_01',
    actorRole: 'CASHIER',
    amountCents: 5000,
    pin,
    tenantId: 'DEFAULT_TENANT_MOCK',
    terminalId: `T-${Math.random()}`,
    ...overrides,
  });

  it('onaylayabilen roller jeton üretir', async () => {
    for (const pin of ['1111', '2222', '3333']) {
      const result = await tauriInvoke<Record<string, unknown>>('verify_manager_pin', {
        payload: approvalPayload(pin),
      });
      expect(result.approved).toBe(true);
      expect(typeof result.approvalToken).toBe('string');
      // PIN yanıtta hiçbir yerde görünmez.
      expect(JSON.stringify(result)).not.toContain(pin);
    }
  });

  it('kasa ve mutfak PIN\'i onay üretmez', async () => {
    const code = await captureError(
      tauriInvoke('verify_manager_pin', { payload: approvalPayload('4444') }),
    );
    expect(code).toBe(APPROVAL_ERROR.INVALID_PIN);

    const kitchen = await captureError(
      tauriInvoke('verify_manager_pin', { payload: approvalPayload('6666') }),
    );
    expect(kitchen).toBe(APPROVAL_ERROR.INVALID_PIN);
  });

  it('kendi işlemini onaylayan kişi reddedilir', async () => {
    const code = await captureError(
      tauriInvoke('verify_manager_pin', {
        payload: approvalPayload('2222', { actorRole: 'OWNER', actorId: 'OWNER_01' }),
      }),
    );
    expect(code).toBe(APPROVAL_ERROR.SELF_APPROVAL);
  });

  it('jetonsuz iptal reddedilir', async () => {
    const code = await captureError(
      tauriInvoke('void_order', {
        payload: {
          orderId: 'tbl-mock-void',
          tableId: 'tbl-mock-void',
          reason: 'test',
          actorId: 'CASHIER_01',
          actorRole: 'CASHIER',
        },
        tenantId: 'DEFAULT_TENANT_MOCK',
      }),
    );
    expect(code).toBe(APPROVAL_ERROR.TOKEN_REQUIRED);
  });

  it('jeton tek kullanımlıktır', async () => {
    const orderId = 'tbl-replay-01';
    // Jeton **bu** adisyon için üretilir; kapsam hatasına düşmemek için
    // kaynak kimliği onay isteğiyle aynı olmalıdır.
    const approval = await tauriInvoke<Record<string, string>>('verify_manager_pin', {
      payload: approvalPayload('3333', { resourceId: orderId }),
    });

    const first = await tauriInvoke('void_order', {
      payload: {
        orderId,
        tableId: orderId,
        reason: 'test',
        actorId: 'CASHIER_01',
        actorRole: 'CASHIER',
        approvalToken: approval.approvalToken,
      },
      tenantId: 'DEFAULT_TENANT_MOCK',
    });
    expect(first).toBeTruthy();

    const replayCode = await captureError(
      tauriInvoke('void_order', {
        payload: {
          orderId,
          tableId: orderId,
          reason: 'test',
          actorId: 'CASHIER_01',
          actorRole: 'CASHIER',
          approvalToken: approval.approvalToken,
        },
        tenantId: 'DEFAULT_TENANT_MOCK',
      }),
    );
    expect(replayCode).toBe(APPROVAL_ERROR.TOKEN_USED);
  });

  it('jeton başka bir adisyona taşınamaz', async () => {
    const approval = await tauriInvoke<Record<string, string>>('verify_manager_pin', {
      payload: approvalPayload('2222', { resourceId: 'tbl-scope-a' }),
    });

    const code = await captureError(
      tauriInvoke('void_order', {
        payload: {
          orderId: 'tbl-scope-b',
          tableId: 'tbl-scope-b',
          reason: 'test',
          actorId: 'CASHIER_01',
          actorRole: 'CASHIER',
          approvalToken: approval.approvalToken,
        },
        tenantId: 'DEFAULT_TENANT_MOCK',
      }),
    );
    expect(code).toBe(APPROVAL_ERROR.TOKEN_SCOPE);
  });

  it('indirimli ödeme onaysız reddedilir', async () => {
    const code = await captureError(
      tauriInvoke('process_payment', {
        payload: {
          transactionId: 'txn-disc-01',
          orderId: 'ord-disc-01',
          timestamp: new Date().toISOString(),
          method: 'CASH',
          amountTendered: 900,
          totalAmount: 900,
          changeAmount: 0,
          cashierId: 'CASHIER_01',
          items: [
            {
              id: 'itm-1',
              product: { id: 'prd-1', name: 'Ürün', price: 1000 },
              quantity: 1,
              unitPrice: 1000,
              taxRate: 10,
              subtotal: 900,
              taxAmount: 90,
              total: 990,
              discount: { type: 'FIXED_AMOUNT', value: 100 },
            },
          ],
        },
        actorRole: 'CASHIER',
        tenantId: 'DEFAULT_TENANT_MOCK',
      }),
    );
    expect(code).toBe(APPROVAL_ERROR.TOKEN_REQUIRED);
  });

  it('indirimsiz ödeme onay istemez', async () => {
    const result = await tauriInvoke<Record<string, unknown>>('process_payment', {
      payload: {
        transactionId: 'txn-plain-01',
        orderId: 'ord-plain-01',
        timestamp: new Date().toISOString(),
        method: 'CASH',
        amountTendered: 1100,
        totalAmount: 1100,
        changeAmount: 0,
        cashierId: 'CASHIER_01',
        items: [
          {
            id: 'itm-2',
            product: { id: 'prd-2', name: 'Ürün', price: 1000 },
            quantity: 1,
            unitPrice: 1000,
            taxRate: 10,
            subtotal: 1000,
            taxAmount: 100,
            total: 1100,
          },
        ],
      },
      actorRole: 'CASHIER',
      tenantId: 'DEFAULT_TENANT_MOCK',
    });
    expect(result.success).toBe(true);
  });

  it('5 hatalı denemeden sonra terminal kilitlenir', async () => {
    const terminalId = 'T-LOCKOUT-01';
    const codes: (string | null)[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      codes.push(
        await captureError(
          tauriInvoke('verify_manager_pin', {
            payload: approvalPayload('9999', { terminalId }),
          }),
        ),
      );
    }

    // İlk 5 deneme hatalı PIN, 6. deneme kilit.
    expect(codes.slice(0, 5).every((code) => code === APPROVAL_ERROR.INVALID_PIN)).toBe(true);
    expect(codes[5]).toBe(APPROVAL_ERROR.LOCKED);

    // Kilitliyken doğru PIN de reddedilir.
    const locked = await captureError(
      tauriInvoke('verify_manager_pin', {
        payload: approvalPayload('2222', { terminalId }),
      }),
    );
    expect(locked).toBe(APPROVAL_ERROR.LOCKED);
  });

  it('büyük indirimde MASTER onaylayamaz', async () => {
    const code = await captureError(
      tauriInvoke('verify_manager_pin', {
        payload: approvalPayload('1111', {
          operation: 'DISCOUNT',
          amountCents: 60000,
          discountPercent: 25,
        }),
      }),
    );
    expect(code).toBe('UNAUTHORIZED');

    // Aynı indirim işletme sahibi tarafından onaylanabilir.
    const owner = await tauriInvoke<Record<string, unknown>>('verify_manager_pin', {
      payload: approvalPayload('2222', {
        operation: 'DISCOUNT',
        amountCents: 60000,
        discountPercent: 25,
      }),
    });
    expect(owner.approved).toBe(true);
  });

  it('ikram yüzeyinde kasa onaylayamaz', async () => {
    const code = await captureError(
      tauriInvoke('verify_manager_pin', {
        payload: approvalPayload('1111', {
          operation: 'COMPLIMENTARY',
          amountCents: 11000,
          discountPercent: 100,
        }),
      }),
    );
    expect(code).toBe('UNAUTHORIZED');
  });
});
