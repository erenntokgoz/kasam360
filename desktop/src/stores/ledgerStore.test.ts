import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));

import { useLedgerStore } from './ledgerStore';

describe('yönetim gezinmesi', () => {
  beforeEach(() => useLedgerStore.setState({ activeErpTab: 'PANORAMA', erpSection: null }));

  it('Panorama uyarısı yeni bölüm ve alt sayfaya gider', () => {
    useLedgerStore.getState().openAlertTarget('PAYROLL');
    expect(useLedgerStore.getState()).toMatchObject({ activeErpTab: 'STAFF', erpSection: 'PAYROLL' });
    useLedgerStore.getState().openAlertTarget('LOG');
    expect(useLedgerStore.getState()).toMatchObject({ activeErpTab: 'AUDIT', erpSection: null });
    useLedgerStore.getState().openAlertTarget('EXPENSES');
    expect(useLedgerStore.getState()).toMatchObject({ activeErpTab: 'FINANCE', erpSection: null });
  });

  it('bilinmeyen hedef ekranı değiştirmez', () => {
    useLedgerStore.getState().openAlertTarget('LEGAL');
    expect(useLedgerStore.getState().activeErpTab).toBe('PANORAMA');
  });
});
