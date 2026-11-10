import { describe, expect, it } from 'vitest';
import { BLOCKED_BY_SHIFT, checkResultText, planUpdateNotice, type UpdateCheck } from './appUpdate';

const available: UpdateCheck = { currentVersion: '0.2.0', status: 'AVAILABLE', version: '0.3.0', notes: null, message: null };

describe('planUpdateNotice', () => {
  it('açık vardiya varken kurulum kapalı, bildirim açık kalır', () => {
    expect(planUpdateNotice(available, { hasOpenShift: true }, null)).toEqual({
      kind: 'ready', version: '0.3.0', canInstall: false, blockedReason: BLOCKED_BY_SHIFT,
    });
  });

  it('vardiya yokken yalnız onayla kurulabilir hale gelir', () => {
    expect(planUpdateNotice(available, { hasOpenShift: false }, null)).toMatchObject({ kind: 'ready', canInstall: true, blockedReason: null });
  });

  it('kapatılan sürüm bir daha gösterilmez, daha yeni sürüm gösterilir', () => {
    expect(planUpdateNotice(available, { hasOpenShift: false }, '0.3.0').kind).toBe('none');
    expect(planUpdateNotice({ ...available, version: '0.3.1' }, { hasOpenShift: false }, '0.3.0').kind).toBe('ready');
  });

  it('güncel, çevrimdışı ve hata durumunda bildirim yok', () => {
    for (const status of ['UP_TO_DATE', 'OFFLINE', 'ERROR', 'UNCONFIGURED'] as const) {
      expect(planUpdateNotice({ ...available, status }, { hasOpenShift: false }, null).kind).toBe('none');
    }
    expect(planUpdateNotice(null, { hasOpenShift: false }, null).kind).toBe('none');
  });
});

describe('checkResultText', () => {
  it('çevrimdışı satışın etkilenmediğini söyler, hata nedeni gösterilir', () => {
    expect(checkResultText({ ...available, status: 'OFFLINE' })).toContain('satış etkilenmez');
    expect(checkResultText({ ...available, status: 'ERROR', message: 'imza geçersiz' })).toContain('imza geçersiz');
  });
});
