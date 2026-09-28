import { PaymentPayload, PaymentResult } from '../../../presentation/types';
import { Money } from './Money';

export type PaymentState = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface PaymentTransactionRecord {
  idempotencyKey: string;
  transactionId: string;
  orderId?: string;
  state: PaymentState;
  amountTendered: number;
  totalAmount: number;
  changeAmount: number;
  payload: PaymentPayload;
  result: PaymentResult;
  auditTrail: { timestamp: string; state: PaymentState; note: string }[];
}

export class PaymentEngine {
  private transactions = new Map<string, PaymentTransactionRecord>();
  private idempotencyMap = new Map<string, PaymentResult>();

  // Gerçek bir sistemde, buraya bir veritabanı deposu enjekte ederdik.
  constructor(private checkAuthFn?: (code?: string) => boolean) {}

  public processPayment(payload: PaymentPayload): PaymentResult {
    // 1. Idempotency (Eş Etkililik) Kontrolü
    if (payload.idempotencyKey && this.idempotencyMap.has(payload.idempotencyKey)) {
      return this.idempotencyMap.get(payload.idempotencyKey)!;
    }

    const timestamp = new Date().toISOString();
    const transactionId = payload.transactionId;

    // Bu işlemin zaten nihai bir durumda olup olmadığını kontrol et
    const existingTx = this.transactions.get(transactionId);

    if (payload.transactionType === 'CANCEL') {
      return this.handleCancellation(payload, existingTx, timestamp);
    }

    if (payload.transactionType === 'REFUND') {
      return this.handleRefund(payload, existingTx, timestamp);
    }

    // Varsayılan işlem PAYMENT (ÖDEME)
    if (existingTx && existingTx.state === 'COMPLETED') {
      return this.createFailureResult(transactionId, 'Duplicate payment: Transaction already completed');
    }

    // 2. Tutar Doğrulamaları (Dahili olarak kayan noktalı sayı hesaplaması yapılmaz)
    const totalAmount = Money.fromFloat(payload.totalAmount);
    let amountTendered = Money.fromCents(0);

    if (payload.method === 'SPLIT' && payload.splits) {
      for (const split of payload.splits) {
        amountTendered = amountTendered.add(Money.fromFloat(split.amount));
      }
    } else {
      amountTendered = Money.fromFloat(payload.amountTendered);
    }

    // Yetersiz Nakit
    if (amountTendered.lessThan(totalAmount)) {
      return this.createFailureResult(transactionId, 'Insufficient payment amount');
    }

    const changeAmount = amountTendered.subtract(totalAmount);

    // 3. Durumu Kaydet
    const receiptNo = payload.isOffline
      ? `OFFLINE-${transactionId.substring(0, 8).toUpperCase()}`
      : `REC-${Date.now()}`;

    const result: PaymentResult = {
      success: true,
      transactionId,
      fiscalReceiptNo: receiptNo,
      timestamp,
      message: `Payment successful. Change: ${changeAmount.amount.toFixed(2)}`,
    };

    const newTx: PaymentTransactionRecord = {
      idempotencyKey: payload.idempotencyKey || transactionId,
      transactionId,
      orderId: payload.orderId,
      state: 'COMPLETED',
      amountTendered: amountTendered.amount,
      totalAmount: totalAmount.amount,
      changeAmount: changeAmount.amount,
      payload,
      result,
      auditTrail: [
        { timestamp, state: 'PENDING', note: 'Transaction initiated' },
        { timestamp, state: 'COMPLETED', note: `Payment processed via ${payload.method}` },
      ],
    };

    this.transactions.set(transactionId, newTx);
    if (payload.idempotencyKey) {
      this.idempotencyMap.set(payload.idempotencyKey, result);
    }

    return result;
  }

  private handleCancellation(payload: PaymentPayload, existingTx: PaymentTransactionRecord | undefined, timestamp: string): PaymentResult {
    if (!existingTx) {
      return this.createFailureResult(payload.transactionId, 'Transaction not found for cancellation');
    }
    if (existingTx.state === 'COMPLETED') {
      return this.createFailureResult(payload.transactionId, 'Cannot cancel a completed transaction. Use refund instead.');
    }
    if (existingTx.state === 'CANCELLED') {
      return existingTx.result;
    }

    existingTx.state = 'CANCELLED';
    existingTx.auditTrail.push({ timestamp, state: 'CANCELLED', note: 'Transaction cancelled' });
    const result = {
      success: true,
      transactionId: payload.transactionId,
      timestamp,
      message: 'Transaction cancelled successfully',
    };
    existingTx.result = result;
    if (payload.idempotencyKey) {
      this.idempotencyMap.set(payload.idempotencyKey, result);
    }
    return result;
  }

  private handleRefund(payload: PaymentPayload, existingTx: PaymentTransactionRecord | undefined, timestamp: string): PaymentResult {
    if (!existingTx) {
      return this.createFailureResult(payload.transactionId, 'Transaction not found for refund');
    }
    if (existingTx.state !== 'COMPLETED') {
      return this.createFailureResult(payload.transactionId, 'Cannot refund an incomplete transaction');
    }

    // 4. İade Yetkilendirmesi
    if (this.checkAuthFn && !this.checkAuthFn(payload.authorizationCode)) {
      return this.createFailureResult(payload.transactionId, 'Unauthorized refund request');
    }

    existingTx.state = 'REFUNDED';
    existingTx.auditTrail.push({ timestamp, state: 'REFUNDED', note: `Refund processed. Auth: ${payload.authorizationCode || 'N/A'}` });
    
    const result = {
      success: true,
      transactionId: payload.transactionId,
      timestamp,
      message: 'Transaction refunded successfully',
    };
    existingTx.result = result;
    if (payload.idempotencyKey) {
      this.idempotencyMap.set(payload.idempotencyKey, result);
    }
    return result;
  }

  private createFailureResult(transactionId: string, errorDetail: string): PaymentResult {
    return {
      success: false,
      transactionId,
      timestamp: new Date().toISOString(),
      errorDetail,
      message: errorDetail,
    };
  }

  public getTransaction(transactionId: string): PaymentTransactionRecord | undefined {
    return this.transactions.get(transactionId);
  }
}
