import { afterEach, describe, expect, it } from 'vitest';
import { useUIStore } from './uiStore';

afterEach(() => useUIStore.getState().clearNotice());

describe('işlem bildirimleri', () => {
  it('en yeni üç farklı bildirimi sıralı tutar ve hatayı başarıdan ayırır', () => {
    const { showNotice, showErrorNotice } = useUIStore.getState();
    showNotice('Kaydedildi.');
    showErrorNotice('Gider kaydedilemedi.');
    showNotice('Rapor hazır.');
    showErrorNotice('  Gider kaydedilemedi. ');
    showErrorNotice('Yedek alınamadı.');

    expect(useUIStore.getState().notices.map(({ message, kind }) => [message, kind])).toEqual([
      ['Rapor hazır.', 'success'],
      ['Gider kaydedilemedi.', 'error'],
      ['Yedek alınamadı.', 'error'],
    ]);
  });

  it('eski zamanlayıcı aynı hatanın yeni bildirimini kapatmaz', () => {
    const { showErrorNotice, clearNotice } = useUIStore.getState();
    showErrorNotice('Gider kaydedilemedi.');
    const oldId = useUIStore.getState().notices[0].id;

    showErrorNotice('Gider kaydedilemedi.');
    clearNotice(oldId);

    expect(useUIStore.getState().notices).toHaveLength(1);
    expect(useUIStore.getState().notices[0].id).not.toBe(oldId);
  });

  it('tekrar eden bildirimi tek kartta sayar, türü farklıysa ayrı tutar', () => {
    const { showNotice, pushNotice } = useUIStore.getState();
    showNotice('Kaydedildi.');
    showNotice('Kaydedildi.');
    pushNotice('Kaydedildi.', 'info');
    pushNotice('Yazıcı yanıt vermiyor.', 'warning');
    showNotice(' Kaydedildi.');

    expect(useUIStore.getState().notices.map(({ message, kind, count }) => [message, kind, count])).toEqual([
      ['Kaydedildi.', 'info', 1],
      ['Yazıcı yanıt vermiyor.', 'warning', 1],
      ['Kaydedildi.', 'success', 3],
    ]);
  });
});
