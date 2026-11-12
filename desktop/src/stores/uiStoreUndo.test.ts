import { describe, expect, it, vi } from 'vitest';
import { useUIStore } from './uiStore';

describe('geri alınabilir bildirim', () => {
  it('eylem düğmesi taşır ve çalıştırılınca eylem bir kez çağrılır', () => {
    const run = vi.fn();
    useUIStore.getState().clearNotice();
    useUIStore.getState().pushUndoNotice('Öğe kaldırıldı.', { label: 'Geri al', run });
    const [notice] = useUIStore.getState().notices;
    expect(notice?.action?.label).toBe('Geri al');
    notice?.action?.run();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
