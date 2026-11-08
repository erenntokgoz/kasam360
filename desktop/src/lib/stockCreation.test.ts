import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { invokeIPC } from '../services/tauriClient';
import { createStockItem, setProductRaw } from './stockCreation';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const ipc = vi.mocked(invokeIPC);

describe('işlem içinden stok kaydı', () => {
  beforeEach(() => {
    ipc.mockReset();
    useAuthStore.setState({ user: { userId: 'usr_owner', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_test', activeModules: [] }, isAuthenticated: true, isLocked: false, mustChangePin: false });
  });

  it('hammaddeyi kategorisiz ve satışa kapalı oluşturur, sunucunun kimliğini döndürür', async () => {
    ipc.mockResolvedValue({ id: 'prd_flour', category_id: '', name: 'Un', price_cents: 0, is_active: false, is_86: false, stock_unit: 'kg', tax_rate_bp: 1000, is_raw: true });
    const item = await createStockItem({ name: ' Un ', stockUnit: 'kg' });
    expect(item.id).toBe('prd_flour');
    expect(item.isActive).toBe(false);
    expect(item.stockUnit).toBe('kg');
    expect(ipc).toHaveBeenCalledWith('create_product', expect.objectContaining({ name: 'Un', categoryId: null, priceCents: 0, isActive: false, isRaw: true, stockUnit: 'kg', tenantId: 'tnt_test', actorId: 'usr_owner' }));
  });

  it('hammaddeyi satış ürününe çevirirken menü kategorisini yazar ve kapalı bırakır', async () => {
    ipc.mockResolvedValue({ id: 'prd_flour', category_id: 'cat_menu', name: 'Un', price_cents: 0, is_active: false, is_86: false, stock_unit: 'kg', tax_rate_bp: 100, is_raw: false });
    const raw = { id: 'prd_flour', categoryId: '', name: 'Un', priceCents: 0, isActive: false, is86: false, stockUnit: 'kg', taxRateBp: 100, barcode: '869', isRaw: true };
    const item = await setProductRaw(raw, false, 'cat_menu');
    expect(item.isRaw).toBe(false);
    expect(ipc).toHaveBeenCalledWith('update_product', expect.objectContaining({ id: 'prd_flour', categoryId: 'cat_menu', isRaw: false, isActive: false, barcode: '869', taxRateBp: 100, stockUnit: 'kg' }));
  });

  it('kategorisiz hammaddeyi kategori seçilmeden satış ürününe çevirmez', async () => {
    const raw = { id: 'prd_flour', categoryId: '', name: 'Un', priceCents: 0, isActive: false, is86: false, stockUnit: 'kg', isRaw: true };
    await expect(setProductRaw(raw, false)).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('satış ürününü hammaddeye çevirince satışı kapatır ve kategoriyi düşürür', async () => {
    ipc.mockResolvedValue({ id: 'prd_tea', category_id: '', name: 'Çay', price_cents: 3000, is_active: false, is_86: false, stock_unit: 'adet', is_raw: true });
    await setProductRaw({ id: 'prd_tea', categoryId: 'cat_1', name: 'Çay', priceCents: 3000, isActive: true, is86: false, isRaw: false }, true);
    expect(ipc).toHaveBeenCalledWith('update_product', expect.objectContaining({ isRaw: true, isActive: false, priceCents: 3000, categoryId: null }));
  });

  it('adsız veya geçersiz birimle yazmaz', async () => {
    await expect(createStockItem({ name: ' ', stockUnit: 'kg' })).rejects.toThrow();
    await expect(createStockItem({ name: 'Un', stockUnit: 'koli' })).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('kilitli veya yetkisiz oturumda kayıt açmaz', async () => {
    useAuthStore.setState({ isLocked: true });
    await expect(createStockItem({ name: 'Un', stockUnit: 'kg' })).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('ürün kaydı reddedilince başarı veya yeni kimlik üretmez', async () => {
    ipc.mockRejectedValue(new Error('QUORUM_LOST'));
    await expect(createStockItem({ name: 'Un', stockUnit: 'kg' })).rejects.toThrow('QUORUM_LOST');
  });
});
