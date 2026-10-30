import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetupStore } from './setupStore';
import { invokeIPC } from '../services/tauriClient';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));

const invokeMock = vi.mocked(invokeIPC);
const draft = { businessName: 'Deniz', taxId: '', phone: '', address: '', ownerName: 'Ayşe', deviceName: '' };

describe('kurulum durumu', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useSetupStore.setState({ phase: 'LOADING', mode: null, error: null });
  });

  it('yarım kalan kurulumu seçimi ve taslağıyla sürdürür', async () => {
    invokeMock.mockResolvedValueOnce({ status: 'PENDING', mode: 'NEW', draft });
    await useSetupStore.getState().load();
    expect(useSetupStore.getState()).toMatchObject({ phase: 'PENDING', mode: 'NEW', draft });
  });

  it('durum okunamazsa kurulmuş saymaz', async () => {
    invokeMock.mockRejectedValueOnce(new Error('disk'));
    await useSetupStore.getState().load();
    expect(useSetupStore.getState().phase).toBe('ERROR');
  });

  it('taslağa PIN yazmaz; PIN yalnız tamamlama çağrısında gider', async () => {
    invokeMock.mockResolvedValue(undefined);
    await useSetupStore.getState().saveProgress('NEW', draft);
    expect(JSON.stringify(invokeMock.mock.calls[0])).not.toContain('pin');

    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce({ status: 'COMPLETE', mode: 'NEW', draft });
    await useSetupStore.getState().completeNew(draft, '4827', '4827');
    expect(invokeMock.mock.calls[0][0]).toBe('complete_business_setup');
    expect(useSetupStore.getState().phase).toBe('COMPLETE');
  });

  it('başarısız kurulum tamamlandı sayılmaz', async () => {
    useSetupStore.setState({ phase: 'PENDING' });
    invokeMock.mockRejectedValueOnce(new Error('CONFLICT'));
    await expect(useSetupStore.getState().joinExisting('kod', 'Kasa 2')).rejects.toThrow();
    expect(useSetupStore.getState().phase).toBe('PENDING');
  });
});
