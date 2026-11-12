import { describe, expect, it, vi } from 'vitest';
import { KITCHEN_SENT_MESSAGE, sendAndReturnToFloor } from './sendFlow';

function deps(send: () => Promise<boolean>) {
  return {
    send: vi.fn(send),
    ringBell: vi.fn(),
    goToFloor: vi.fn(),
    refreshFloor: vi.fn(async () => undefined),
    notifySuccess: vi.fn(),
  };
}

describe('mutfağa gönderim akışı', () => {
  it('başarıda doğrudan salona döner ve başarı bildirimi verir', async () => {
    const flow = deps(async () => true);
    expect(await sendAndReturnToFloor(flow)).toBe(true);
    expect(flow.goToFloor).toHaveBeenCalledTimes(1);
    expect(flow.notifySuccess).toHaveBeenCalledWith(KITCHEN_SENT_MESSAGE);
    expect(flow.ringBell).toHaveBeenCalledTimes(1);
    expect(flow.refreshFloor).toHaveBeenCalledTimes(1);
  });

  it('başarısızlıkta adisyondan çıkmaz, başarı göstermez, salonu yenilemez', async () => {
    const flow = deps(async () => false);
    expect(await sendAndReturnToFloor(flow)).toBe(false);
    expect(flow.goToFloor).not.toHaveBeenCalled();
    expect(flow.notifySuccess).not.toHaveBeenCalled();
    expect(flow.ringBell).not.toHaveBeenCalled();
    expect(flow.refreshFloor).not.toHaveBeenCalled();
  });

  it('salon okuması hata verse de dönüş ve bildirim tamamlanır', async () => {
    const flow = deps(async () => true);
    flow.refreshFloor.mockRejectedValue(new Error('okunamadı'));
    expect(await sendAndReturnToFloor(flow)).toBe(true);
    expect(flow.goToFloor).toHaveBeenCalledTimes(1);
  });
});

describe('mutfak ekranı olmayan işletme', () => {
  it('zil çalmaz, mesaj yalnız kaydı söyler', async () => {
    const flow = { ...deps(async () => true), hasKitchenScreen: false };
    expect(await sendAndReturnToFloor(flow)).toBe(true);
    expect(flow.ringBell).not.toHaveBeenCalled();
    expect(flow.notifySuccess).toHaveBeenCalledWith('Sipariş kaydedildi.');
  });
});
