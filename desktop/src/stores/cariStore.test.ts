import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIPC = vi.fn();
vi.mock('../services/tauriClient', () => ({ invokeIPC }));

const { useAuthStore } = await import('./authStore');
const { useCariStore } = await import('./cariStore');

describe('cariStore', () => {
  beforeEach(() => {
    invokeIPC.mockReset();
    useCariStore.setState({ cards: [], debts: [], statement: null, awaiting: [], loadError: null });
    useAuthStore.setState({
      user: { userId: 'usr_1', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_1' },
    });
  });

  it('ödemeyi oturum kapsamı ve işlem anahtarıyla backendde yürütür', async () => {
    invokeIPC.mockResolvedValue({});
    await useCariStore.getState().payDebt({
      operationId: 'op_1',
      debtId: 'dbt_1',
      expectedVersion: 2,
      amountCents: 1500,
      paymentMethod: 'CREDIT_CARD',
    });
    expect(invokeIPC).toHaveBeenCalledWith('pay_debt', {
      actorRole: 'OWNER',
      payload: {
        operationId: 'op_1',
        debtId: 'dbt_1',
        expectedVersion: 2,
        amountCents: 1500,
        paymentMethod: 'CREDIT_CARD',
        tenantId: 'tnt_1',
        actorId: 'usr_1',
      },
    });
  });

  it('backend hatası görünür kalır, boş liste başarı sayılmaz', async () => {
    invokeIPC.mockRejectedValue('UNAUTHORIZED: tenant_id is required');
    await useCariStore.getState().loadCards('CUSTOMER', '');
    expect(useCariStore.getState().loadError).toBe('tenant_id is required');
  });

  it('oturum yoksa komut çağrılmaz', async () => {
    useAuthStore.setState({ user: null });
    await useCariStore.getState().loadAwaiting();
    expect(invokeIPC).not.toHaveBeenCalled();
    expect(useCariStore.getState().loadError).toBe('Oturum açık değil.');
  });

  it('başarısız ödeme hatayı çağırana taşır', async () => {
    invokeIPC.mockRejectedValue('CONFLICT: bakiye değişti');
    await expect(
      useCariStore.getState().payDebt({
        operationId: 'op_2',
        debtId: 'dbt_1',
        expectedVersion: 0,
        amountCents: 100,
        paymentMethod: 'CASH',
      })
    ).rejects.toBe('CONFLICT: bakiye değişti');
  });
});
