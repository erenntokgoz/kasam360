import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentEngine } from '../../src/domain/usecases/payment/PaymentEngine';
import { PaymentPayload } from '../../src/presentation/types';

describe('Payment Engine', () => {
  let engine: PaymentEngine;

  beforeEach(() => {
    // A simple auth check: 'ADMIN123' is authorized
    engine = new PaymentEngine((code) => code === 'ADMIN123');
  });

  const createBasePayload = (overrides?: Partial<PaymentPayload>): PaymentPayload => ({
    transactionId: 'TXN-1001',
    timestamp: new Date().toISOString(),
    method: 'CASH',
    amountTendered: 100,
    totalAmount: 100,
    changeAmount: 0,
    items: [],
    ...overrides,
  });

  it('handles exact cash payment correctly', () => {
    const payload = createBasePayload();
    const result = engine.processPayment(payload);

    expect(result.success).toBe(true);
    expect(result.fiscalReceiptNo).toBeDefined();

    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.state).toBe('COMPLETED');
    expect(tx?.changeAmount).toBe(0);
  });

  it('rejects insufficient cash payment', () => {
    const payload = createBasePayload({
      amountTendered: 50,
      totalAmount: 100,
    });
    const result = engine.processPayment(payload);

    expect(result.success).toBe(false);
    expect(result.errorDetail).toBe('Insufficient payment amount');
  });

  it('calculates change for overpayment', () => {
    const payload = createBasePayload({
      amountTendered: 150.50,
      totalAmount: 100.25,
    });
    const result = engine.processPayment(payload);

    expect(result.success).toBe(true);
    
    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.state).toBe('COMPLETED');
    expect(tx?.changeAmount).toBe(50.25); // (150.50 - 100.25)
  });

  it('supports split payment', () => {
    const payload = createBasePayload({
      method: 'SPLIT',
      amountTendered: 100,
      totalAmount: 100,
      splits: [
        { method: 'CASH', amount: 40 },
        { method: 'CREDIT_CARD', amount: 60 },
      ],
    });
    const result = engine.processPayment(payload);

    expect(result.success).toBe(true);
    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.amountTendered).toBe(100);
  });

  it('rejects duplicate payment (double payment check)', () => {
    const payload = createBasePayload();
    engine.processPayment(payload); // 1st time
    
    // Attempting again with same transactionId but NO idempotencyKey
    const result2 = engine.processPayment(payload);
    expect(result2.success).toBe(false);
    expect(result2.errorDetail).toContain('Duplicate payment');
  });

  it('handles duplicate retry safely (idempotency)', () => {
    const payload = createBasePayload({
      idempotencyKey: 'IDEMP-1234'
    });
    const result1 = engine.processPayment(payload);
    
    // Network retry sends EXACT same request
    const result2 = engine.processPayment(payload);
    
    expect(result2.success).toBe(true);
    expect(result2).toEqual(result1); // Should return exactly the same object
  });

  it('processes refund with authorization', () => {
    const payload = createBasePayload();
    engine.processPayment(payload);

    const refundPayload = createBasePayload({
      transactionType: 'REFUND',
      authorizationCode: 'ADMIN123'
    });
    
    const refundResult = engine.processPayment(refundPayload);
    expect(refundResult.success).toBe(true);
    expect(refundResult.message).toContain('refunded');

    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.state).toBe('REFUNDED');
  });

  it('rejects unauthorized refund', () => {
    const payload = createBasePayload();
    engine.processPayment(payload);

    const refundPayload = createBasePayload({
      transactionType: 'REFUND',
      authorizationCode: 'WRONG'
    });
    
    const refundResult = engine.processPayment(refundPayload);
    expect(refundResult.success).toBe(false);
    expect(refundResult.errorDetail).toBe('Unauthorized refund request');
  });

  it('generates deterministic offline receipt numbers', () => {
    const payload = createBasePayload({
      isOffline: true,
      transactionId: 'TXN-ABCDEFGH'
    });
    const result = engine.processPayment(payload);
    
    expect(result.success).toBe(true);
    expect(result.fiscalReceiptNo).toBe('OFFLINE-TXN-ABCD');
  });

  it('maintains an audit trail of state changes', () => {
    const payload = createBasePayload();
    engine.processPayment(payload);
    
    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.auditTrail.length).toBeGreaterThan(0);
    expect(tx?.auditTrail.map(a => a.state)).toEqual(['PENDING', 'COMPLETED']);
  });

  it('does not allow closed transactions to be silently modified', () => {
    const payload = createBasePayload();
    engine.processPayment(payload);

    // Any normal PAYMENT attempt on completed tx will fail
    const payloadAgain = createBasePayload({ amountTendered: 200 }); // Try to change amount
    const result = engine.processPayment(payloadAgain);
    expect(result.success).toBe(false);
    expect(result.errorDetail).toContain('Duplicate payment');

    // Refund correctly records the state transition, doesn't just overwrite it quietly
    const refundPayload = createBasePayload({
      transactionType: 'REFUND',
      authorizationCode: 'ADMIN123'
    });
    engine.processPayment(refundPayload);
    const tx = engine.getTransaction(payload.transactionId);
    expect(tx?.state).toBe('REFUNDED');
    expect(tx?.auditTrail[tx.auditTrail.length - 1].state).toBe('REFUNDED');
  });
});
