import { renderToString } from 'react-dom/server';
import React from 'react';

import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { ReceiptViewerModal } from '../../src/presentation/components/ledger/ReceiptViewerModal';
import { formatCents, movementTypeLabel } from '../../src/presentation/types/ledger';
import type { FinancialMovementDto, ReceiptDto } from '../../src/presentation/types/ledger';

// SSR: renderToString sırasında getState verilerinin okunması için bağlanır.
// @ts-expect-error React useSyncExternalStore mock for SSR testing
React.useSyncExternalStore = (subscribe: unknown, getSnapshot: unknown) => getSnapshot();

/**
 * Faz 7 — Fiş ve hesap defteri sözleşme testleri.
 *
 * Üç kuralı kilitler:
 *  1. Fiş **tahsilattan** türetilir; fişi olmayan hareket "Fiş yok" olarak durur.
 *  2. Tenant ve rol kapıları fail-closed: eksikse istek reddedilir, başka
 *     işletmenin fişi okunamaz.
 *  3. Kalem kaydı yoksa alt toplam/KDV uydurulmaz (`has_items: false`).
 */
describe('Faz 7 — Hesap Defteri finansal hareketleri ve fiş görüntüleyici', () => {
  const tenantId = 'DEFAULT_TENANT';
  const otherTenantId = 'BASKA_ISLETME';

  const settle = async (transactionId: string, _tableId: string, amountCents: number, tenant = tenantId) => {
    const res = await tauriInvoke<{ success: boolean; transactionId?: string }>('process_payment', {
      tenantId: tenant,
      payload: {
        transactionId,
        orderId: `ORD_${transactionId}`,
        timestamp: new Date().toISOString(),
        method: 'CASH',
        amountTendered: amountCents,
        totalAmount: amountCents,
        changeAmount: 0,
        items: [],
      },
    });
    expect(res.success).toBe(true);
    return res.transactionId ?? transactionId;
  };

  it('tarih aralığı ve tenant olmadan hareket listelenmez', async () => {
    const today = new Date();
    const from = today.toISOString();
    const to = today.toISOString();

    await expect(
      tauriInvoke('get_financial_movements', { tenantId, actorRole: 'OWNER' }),
    ).rejects.toThrow(/INVALID_ARGUMENT/);

    await expect(
      tauriInvoke('get_financial_movements', { from, to, actorRole: 'OWNER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    // Rol de yoksa yine fail-closed: kapı sırası hata türünü değiştirmez,
    // isteği yine de reddeder.
    await expect(
      tauriInvoke('get_financial_movements', { from, to }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('yalnız çağıran tenant’ın tahsilatları listelenir', async () => {
    const mine = await settle(`TXN_ISL_${Date.now()}`, 'tbl-1', 4500);
    const other = await settle(`TXN_YAB_${Date.now()}`, 'tbl-9', 99900, otherTenantId);

    const today = new Date();
    const movements = await tauriInvoke<FinancialMovementDto[]>('get_financial_movements', {
      tenantId,
      actorRole: 'OWNER',
      from: new Date(today.getTime() - 86_400_000).toISOString(),
      to: new Date(today.getTime() + 86_400_000).toISOString(),
    });

    const ids = movements.map((movement) => movement.receipt_id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);

    const mineRow = movements.find((movement) => movement.receipt_id === mine);
    expect(mineRow?.movement_type).toBe('SALE_PAYMENT');
    expect(mineRow?.amount_cents).toBe(4500);
    // Fiş numarası hareketle birlikte türetilir; istemci uyduramaz.
    expect(mineRow?.fiscal_receipt_no).toBe(`FISC-${mine.slice(0, 6)}`);
  });

  it('başka işletmenin fişi bu tenant üzerinden okunamaz', async () => {
    const foreign = await settle(`TXN_YAB2_${Date.now()}`, 'tbl-8', 15000, otherTenantId);

    const result = await tauriInvoke<ReceiptDto | null>('get_receipt_details', {
      receiptId: foreign,
      actorRole: 'OWNER',
      tenantId,
    });
    expect(result).toBeNull();
  });

  it('yetkisiz rol ve eksik tenant fail-closed davranır', async () => {
    const mine = await settle(`TXN_ROL_${Date.now()}`, 'tbl-2', 2500);

    await expect(
      tauriInvoke('get_receipt_details', { receiptId: mine, actorRole: 'WAITER', tenantId }),
    ).rejects.toThrow(/UNAUTHORIZED/);
    await expect(
      tauriInvoke('get_receipt_details', { receiptId: mine, actorRole: 'OWNER' }),
    ).rejects.toThrow(/UNAUTHORIZED/);
    await expect(
      tauriInvoke('get_financial_movements', {
        from: new Date().toISOString(),
        to: new Date().toISOString(),
        actorRole: 'OWNER',
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('kalem kaydı olmayan tahsilatta has_items false döner (oran uydurmaz)', async () => {
    const mine = await settle(`TXN_KALEM_${Date.now()}`, 'tbl-3', 12300);
    const receipt = await tauriInvoke<ReceiptDto | null>('get_receipt_details', {
      receiptId: mine,
      actorRole: 'CASHIER',
      tenantId,
    });

    expect(receipt).not.toBeNull();
    expect(receipt?.has_items).toBe(false);
    expect(receipt?.items).toHaveLength(0);
    // Alt toplam ve KDV kalem toplamından gelir: boş kalemde sıfırdır.
    expect(receipt?.subtotal_cents).toBe(0);
    expect(receipt?.tax_total_cents).toBe(0);
    // Toplam yine de tahsilatın gerçek tutarıdır.
    expect(receipt?.total_cents).toBe(12300);
  });

  it('fiş görüntüleyici kimlik yoksa hiçbir şey basmaz', () => {
    const html = renderToString(
      React.createElement(ReceiptViewerModal, {
        receiptId: null,
        onClose: () => undefined,
        onNotify: () => undefined,
      }),
    );
    expect(html).toBe('');
  });

  it('hareket türü ve kuruş biçimi tek kaynaktan gelir', () => {
    expect(movementTypeLabel('SALE_PAYMENT')).toBe('Tahsilat');
    expect(movementTypeLabel('CASH_MOVEMENT')).toBe('Kasa Hareketi');
    expect(movementTypeLabel('DEBT_PAYMENT')).toBe('Cari Tahsilat');
    expect(movementTypeLabel('BILINMEYEN')).toBe('Diğer Hareket');

    expect(formatCents(0)).toBe('0,00 ₺');
    expect(formatCents(4500)).toBe('45,00 ₺');
    expect(formatCents(123456)).toBe('1.234,56 ₺');
    expect(formatCents(-2050)).toBe('-20,50 ₺');
  });
});