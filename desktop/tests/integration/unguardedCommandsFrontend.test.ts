/**
 * Faz 17 — Kapısız komutların tarayıcı mockundaki karşılığı
 * Path: tests/integration/unguardedCommandsFrontend.test.ts
 *
 * Backend'de dört komut fail-closed kapıya alındı:
 *   - `get_shift_summary`        → OWNER/MANAGER/CASHIER + kiracı
 *   - `get_stations`             → OWNER/MANAGER/KITCHEN + kiracı
 *   - `update_kds_item_status`   → OWNER/MANAGER/KITCHEN + kiracı
 *   - `get_table_ready_status`   → OWNER/MANAGER/WAITER/KITCHEN + kiracı
 *   - `get_all_table_statuses`   → OWNER/MANAGER/WAITER/KITCHEN + kiracı
 *   - `get_product_modifiers`    → OWNER/MANAGER/WAITER/CASHIER + kiracı
 *
 * Gerekçe: mock gevşek kalırsa tarayıcıda garson mutfağın ekranını, kasa vardiya
 * özetini görür; testler yeşil kalırken üretimde kapı reddeder. Mock backend ile
 * aynı kapıları uygular.
 */

import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

const TENANT = 'DEFAULT_TENANT';

const captureError = async (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => '',
    (err: unknown) => (typeof err === 'string' ? err : String((err as Error)?.message ?? err)),
  );

/**
 * Komut argümanları üretir.
 *
 * `role` verilmezse rol alanları hiç yazılmaz (fail-closed ölçümü).
 * `tenant` verilmezse `TENANT` yazılır; `null` verilirse boş string yazılır
 * (kiracısız çağrının reddedildiğini kanıtlamak için).
 */
const args = (role?: string, tenant: string | null = TENANT) => ({
  ...(role === undefined ? {} : { actorRole: role, actor_role: role }),
  tenantId: tenant ?? '',
  tenant_id: tenant ?? '',
});

describe('Vardiya özeti kapısı (backend `vardiya_oku_kapisi`)', () => {
  it('1. Yalnız sahip, müdür ve kasiyer okuyabilir', async () => {
    for (const role of ['OWNER', 'MANAGER', 'CASHIER']) {
      const summary = await tauriInvoke<unknown>('get_shift_summary', {
        ...args(role),
        shiftId: 'shift_browser_001',
      });
      expect(summary, `${role} vardiya özetini okumalı`).toBeDefined();
    }
  });

  it('2. Garson, mutfak ve rolsüz çağrı reddedilir', async () => {
    for (const role of ['WAITER', 'KITCHEN', undefined]) {
      const err = await captureError(
        tauriInvoke('get_shift_summary', { ...args(role), shiftId: 'shift_browser_001' }),
      );
      expect(err, `${String(role)} vardiya özetini görmemeli`).toContain('UNAUTHORIZED');
    }
  });

  it('3. Kiracı olmadan çağrı reddedilir (fail-closed, DEFAULT_TENANT düşmez)', async () => {
    const err = await captureError(
      tauriInvoke('get_shift_summary', { ...args('OWNER', null), shiftId: 'shift_browser_001' }),
    );
    expect(err).toContain('UNAUTHORIZED');
  });
});

describe('Mutfak istasyonu kapısı (backend `istasyon_okuma_kapisi`)', () => {
  it('4. Yalnız sahip, müdür ve mutfak okuyabilir', async () => {
    for (const role of ['OWNER', 'MANAGER', 'KITCHEN']) {
      const stations = await tauriInvoke<unknown[]>('get_stations', args(role));
      expect(Array.isArray(stations), `${role} istasyon listesini okumalı`).toBe(true);
    }
  });

  it('5. Garson ve kasa mutfağın üretim hattını okuyamaz', async () => {
    for (const role of ['WAITER', 'CASHIER', undefined]) {
      const err = await captureError(tauriInvoke('get_stations', args(role)));
      expect(err, `${String(role)} istasyon listesini görmemeli`).toContain('UNAUTHORIZED');
    }
  });
});

describe('KDS kalem durumu kapısı (backend `kds_durum_kapisi`)', () => {
  it('6. Yalnız sahip, müdür ve mutfak kalemi hazır işaretleyebilir', async () => {
    for (const role of ['OWNER', 'MANAGER', 'KITCHEN']) {
      const res = await tauriInvoke<{ success: boolean }>('update_kds_item_status', {
        ...args(role),
        payload: { itemId: 'item_sample_01', status: 'Ready' },
      });
      expect(res?.success, `${role} kalem durumu güncelleyebilmeli`).toBe(true);
    }
  });

  it('7. Garson ve kasa kalem durumu güncelleyemez', async () => {
    for (const role of ['WAITER', 'CASHIER', undefined]) {
      const err = await captureError(
        tauriInvoke('update_kds_item_status', {
          ...args(role),
          payload: { itemId: 'item_sample_01', status: 'Ready' },
        }),
      );
      expect(err, `${String(role)} kalem durumu güncelleyememeli`).toContain('UNAUTHORIZED');
    }
  });
});

describe('Masa hazır durumu kapısı (backend `masa_okuma_kapisi`)', () => {
  it('8. Kasa masa durumunu okuyamaz, mutfak okuyabilir', async () => {
    for (const role of ['OWNER', 'MANAGER', 'WAITER', 'KITCHEN']) {
      const durum = await tauriInvoke<unknown>('get_table_ready_status', {
        ...args(role),
        tableId: 'tbl-001',
      });
      expect(durum, `${role} masa durumunu okumalı`).toBeDefined();
    }

    const err = await captureError(
      tauriInvoke('get_table_ready_status', { ...args('CASHIER'), tableId: 'tbl-001' }),
    );
    expect(err).toContain('UNAUTHORIZED');
  });

  it('9. Toplu masa durumu da aynı kapıyı uygular', async () => {
    const hepsi = await tauriInvoke<unknown[]>('get_all_table_statuses', args('KITCHEN'));
    expect(Array.isArray(hepsi)).toBe(true);

    const err = await captureError(tauriInvoke('get_all_table_statuses', args('CASHIER')));
    expect(err).toContain('UNAUTHORIZED');
  });
});

describe('Ürün modifier kapısı (backend `siparis_kapisi`)', () => {
  it('10. Sipariş girebilen roller okur, mutfak okuyamaz', async () => {
    for (const role of ['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) {
      const gruplar = await tauriInvoke<unknown[]>('get_product_modifiers', {
        ...args(role),
        productId: 'prd-001',
      });
      expect(Array.isArray(gruplar), `${role} modifier okumalı`).toBe(true);
    }

    const err = await captureError(
      tauriInvoke('get_product_modifiers', { ...args('KITCHEN'), productId: 'prd-001' }),
    );
    expect(err).toContain('UNAUTHORIZED');
  });

  it('11. Rol ve kiracı olmadan çağrı reddedilir', async () => {
    expect(
      await captureError(tauriInvoke('get_product_modifiers', { productId: 'prd-001' })),
    ).toContain('UNAUTHORIZED');
    expect(
      await captureError(
        tauriInvoke('get_product_modifiers', { ...args('OWNER', null), productId: 'prd-001' }),
      ),
    ).toContain('UNAUTHORIZED');
  });
});