import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { invokeIPC } from '../services/tauriClient';
import { createStockItem, createStockCategory } from './stockCreation';

vi.mock('../services/tauriClient', () => ({ invokeIPC: vi.fn() }));
const ipc = vi.mocked(invokeIPC);

describe('işlem içinden stok kaydı', () => {
  beforeEach(() => {
    ipc.mockReset();
    useAuthStore.setState({ user: { userId: 'usr_owner', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_test', activeModules: [] }, isAuthenticated: true, isLocked: false, mustChangePin: false });
  });

  it('hammaddeyi satışa açmadan oluşturur ve sunucunun kimliğini döndürür', async () => {
    ipc.mockResolvedValue({ id: 'prd_flour', category_id: 'cat_raw', name: 'Un', price_cents: 0, is_active: false, is_86: false, stock_unit: 'kg', tax_rate_bp: 1000 });
    const item = await createStockItem({ name: ' Un ', categoryId: 'cat_raw', stockUnit: 'kg' });
    expect(item.id).toBe('prd_flour');
    expect(item.isActive).toBe(false);
    expect(item.stockUnit).toBe('kg');
    expect(ipc).toHaveBeenCalledWith('create_product', expect.objectContaining({ name: 'Un', categoryId: 'cat_raw', priceCents: 0, isActive: false, stockUnit: 'kg', tenantId: 'tnt_test', actorId: 'usr_owner' }));
  });

  it('kategori seçilmeden veya geçersiz birimle yazmaz', async () => {
    await expect(createStockItem({ name: 'Un', categoryId: '', stockUnit: 'kg' })).rejects.toThrow();
    await expect(createStockItem({ name: 'Un', categoryId: 'cat_raw', stockUnit: 'koli' })).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('kilitli veya yetkisiz oturumda kayıt açmaz', async () => {
    useAuthStore.setState({ isLocked: true });
    await expect(createStockCategory('Hammadde')).rejects.toThrow();
    expect(ipc).not.toHaveBeenCalled();
  });

  it('ürün kaydı reddedilince başarı veya yeni kimlik üretmez', async () => {
    ipc.mockRejectedValue(new Error('QUORUM_LOST'));
    await expect(createStockItem({ name: 'Un', categoryId: 'cat_raw', stockUnit: 'kg' })).rejects.toThrow('QUORUM_LOST');
  });

  it('kategoriyi aynı kiracıda açıp dönen kimliği korur', async () => {
    ipc.mockResolvedValue({ id: 'cat_new', name: 'Hammadde', display_order: 0, default_station: null });
    expect((await createStockCategory(' Hammadde ')).id).toBe('cat_new');
    expect(ipc).toHaveBeenCalledWith('create_category', expect.objectContaining({ name: 'Hammadde', tenantId: 'tnt_test', actorRole: 'OWNER' }));
  });
});
