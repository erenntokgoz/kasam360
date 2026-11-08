import { afterEach, describe, expect, it, vi } from 'vitest';
import { licensedModules } from './licenseStore';

afterEach(() => vi.unstubAllEnvs());

describe('tenant lisansı ile özellik kapısı', () => {
  it('V2 lisans yenilenince yetkili özellikleri açar, kaldırılan özelliği kapatır', () => {
    vi.stubEnv('VITE_LICENSE_ENFORCED', 'true');
    const modules = ['feat_kds', 'feat_table_order'];
    const base = {
      state: 'ACTIVE' as const, linked: true, email: 'owner@kasam360.invalid', plan: null,
      validUntil: '2030-01-01T00:00:00Z', checkedAt: null, lastError: null,
    };
    expect(licensedModules(modules, 'OWNER', { ...base, features: ['feat_kds'] })).toEqual(['feat_kds']);
    expect(licensedModules(modules, 'OWNER', { ...base, features: [] })).toEqual([]);
    expect(licensedModules(modules, 'OWNER', { ...base, features: ['feat_kds', 'feat_table_order'] }))
      .toEqual(modules);
  });
});
