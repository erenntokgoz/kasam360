import { describe, expect, it } from 'vitest';
import {
  balanceLabel,
  balanceSide,
  carriedOpenDebts,
  isEditable,
  legacyApproval,
  lineLabel,
  matchingPeriod,
  purchaseLink,
  statementPeriod,
} from './cariLedger';
import type { AwaitingDocument, LedgerDebt, StatementLine } from '../types/ledger';

function line(overrides: Partial<StatementLine>): StatementLine {
  return {
    id: 'l1',
    kind: 'BORC_ACILDI',
    signedAmountCents: 1000,
    createdAt: '2026-11-01 10:00:00',
    balanceAfterCents: 1000,
    debtId: 'dbt_1',
    ...overrides,
  };
}

function debt(overrides: Partial<LedgerDebt>): LedgerDebt {
  return {
    id: 'dbt_1',
    tenantId: 'tnt_1',
    directoryId: 'dir_1',
    directoryName: 'Ali',
    type: 'GIVEN',
    totalAmountCents: 1000,
    remainingAmountCents: 1000,
    status: 'PENDING',
    isCash: false,
    createdAt: '2026-10-01 10:00:00',
    isOverdue: false,
    version: 0,
    ...overrides,
  };
}

describe('cariLedger', () => {
  it('bakiye yönünü işaretten söyler', () => {
    expect(balanceLabel(500)).toBe('Borçlu');
    expect(balanceLabel(-500)).toBe('Alacaklı');
    expect(balanceLabel(0)).toBe('Bakiye yok');
    expect([balanceSide(1), balanceSide(-1), balanceSide(0)]).toEqual(['B', 'A', '']);
  });

  it('satır türünü kaydın kaynağından adlandırır', () => {
    expect(lineLabel(line({ orderId: 'ord_1' }))).toBe('Veresiye');
    expect(lineLabel(line({}))).toBe('Borç kaydı');
    expect(lineLabel(line({ signedAmountCents: -1000 }))).toBe('Alacak kaydı');
    expect(lineLabel(line({ signedAmountCents: -1000, purchaseOrderId: 'po_1' }))).toBe('Mal alımı');
    expect(lineLabel(line({ kind: 'TEDIYE' }))).toBe('Tediye');
    expect(lineLabel(line({ kind: 'IADE' }))).toBe('İade');
  });

  it('belge no sipariş no ile aynıysa bağlantıyı bir kez yazar', () => {
    expect(purchaseLink({ orderNumber: 'S-1', documentNo: 'S-1' })).toBe('Sipariş S-1');
    expect(purchaseLink({ orderNumber: 'S-1', documentNo: 'F-9' })).toBe('Sipariş S-1 · Belge F-9');
    expect(purchaseLink({})).toBeNull();
  });

  it('hızlı dönemleri yerel takvimle üretir ve geri tanır', () => {
    const now = new Date(2026, 0, 15);
    expect(statementPeriod('THIS_MONTH', now)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(statementPeriod('LAST_MONTH', now)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(statementPeriod('ALL', now).to).toBe('2026-01-15');
    expect(matchingPeriod('2025-12-01', '2025-12-31', now)).toBe('LAST_MONTH');
    expect(matchingPeriod('2025-12-02', '2025-12-31', now)).toBeNull();
  });

  it('dönemde satırı olmayan açık kayıt devreden olarak kalır', () => {
    const debts = [debt({ id: 'dbt_eski' }), debt({ id: 'dbt_1' }), debt({ id: 'dbt_kapali', status: 'PAID' })];
    const carried = carriedOpenDebts(debts, [line({ debtId: 'dbt_1' }), line({ kind: 'TAHSILAT', debtId: 'dbt_eski' })]);
    expect(carried.map((item) => item.id)).toEqual(['dbt_eski']);
  });

  it('adisyon, alış ve ödeme görmüş kayıt düzeltilemez', () => {
    expect(isEditable(debt({}))).toBe(true);
    expect(isEditable(debt({ orderId: 'ord_1' }))).toBe(false);
    expect(isEditable(debt({ purchaseOrderId: 'po_1' }))).toBe(false);
    expect(isEditable(debt({ status: 'PARTIAL' }))).toBe(false);
  });

  it('eski teslimi sipariş no ve kabul tutarıyla, vadeyi ödeme gününden işler', () => {
    const document: AwaitingDocument = {
      purchaseOrderId: 'po_1',
      orderNumber: 'S-7',
      supplierId: 'sup_1',
      supplierName: 'Öz Gıda',
      directoryId: 'dir_1',
      receivedTotalCents: 23000,
      paymentTermDays: 30,
    };
    expect(legacyApproval(document, 'op_1', new Date(2026, 10, 4))).toEqual({
      operationId: 'op_1',
      purchaseOrderId: 'po_1',
      documentNo: 'S-7',
      documentTotalCents: 23000,
      dueDate: '2026-12-04',
    });
  });
});
