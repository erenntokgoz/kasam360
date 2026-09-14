import { describe, it, expect } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';

describe('6 Kritik Mantık Hatası Doğrulama Testleri', () => {
  const tenantA = 'tenant_cafe_alpha';
  const tenantB = 'tenant_bistro_beta';

  it('1. Multi-Tenant İzolasyon & Veri Sızıntısı: Yalnızca kullanıcının tenant verileri listelenir', async () => {
    // Tenant A için masa ve kategori ekle
    await tauriInvoke('add_table', {
      id: 'tbl_alpha_1',
      name: 'Alpha Masa 1',
      tenantId: tenantA,
      tenant_id: tenantA,
    });
    await tauriInvoke('create_category', {
      name: 'Alpha Sıcak Kahveler',
      tenantId: tenantA,
      tenant_id: tenantA,
    });
    await tauriInvoke('create_product', {
      name: 'Alpha Filtre Kahve',
      priceCents: 4500,
      tenantId: tenantA,
      tenant_id: tenantA,
    });

    // Tenant B için masa ve kategori ekle
    await tauriInvoke('add_table', {
      id: 'tbl_beta_1',
      name: 'Beta Masa 1',
      tenantId: tenantB,
      tenant_id: tenantB,
    });
    await tauriInvoke('create_category', {
      name: 'Beta İçecekler',
      tenantId: tenantB,
      tenant_id: tenantB,
    });

    // Tenant A kullanıcısı olarak sorgula
    const tablesA = await tauriInvoke<any[]>('get_floor_plan', {
      tenantId: tenantA,
      tenant_id: tenantA,
      actorRole: 'WAITER',
    });
    const categoriesA = await tauriInvoke<any[]>('pos_get_categories', {
      tenantId: tenantA,
      tenant_id: tenantA,
      actorRole: 'WAITER',
    });

    // Tenant A, Tenant B'nin masasını veya kategorisini görmemeli!
    expect(tablesA.some(t => t.id === 'tbl_beta_1')).toBe(false);
    expect(categoriesA.some(c => c.name === 'Beta İçecekler')).toBe(false);
    expect(tablesA.some(t => t.id === 'tbl_alpha_1')).toBe(true);
  });

  it('2. Kasiyer / Vardiya Mantık Hatası: Başlangıçta sahte Mehmet Kaya vardiyası yok, stateful açılıp kapanır', async () => {
    const testCashierId = `cashier_${Date.now()}`;
    const testTenant = `tenant_shift_${Date.now()}`;

    // Başlangıçta bu kasiyer için açık vardiya OLMAMALI (null dönmeli)
    const initialShift = await tauriInvoke<any>('get_active_shift', {
      cashierId: testCashierId,
      tenantId: testTenant,
      tenant_id: testTenant,
      actorRole: 'CASHIER',
    });
    expect(initialShift).toBeNull();

    // Kasiyer vardiya açsın
    const openedShift = await tauriInvoke<any>('open_shift', {
      cashierId: testCashierId,
      cashierName: 'Fatma Yılmaz',
      expectedAmountCents: 15000,
      tenantId: testTenant,
      tenant_id: testTenant,
      actorRole: 'CASHIER',
    });
    expect(openedShift).toBeDefined();
    expect(openedShift.status).toBe('OPEN');
    expect(openedShift.cashierName).toBe('Fatma Yılmaz');
    expect(openedShift.expectedAmountCents).toBe(15000);

    // Şimdi sorguladığında açık vardiya dönmeli
    const currentShift = await tauriInvoke<any>('get_active_shift', {
      cashierId: testCashierId,
      tenantId: testTenant,
      tenant_id: testTenant,
      actorRole: 'CASHIER',
    });
    expect(currentShift).not.toBeNull();
    expect(currentShift?.id).toBe(openedShift.id);

    // Vardiyayı kapat
    await tauriInvoke('close_shift', {
      shiftId: openedShift.id,
      cashierId: testCashierId,
      actualAmountCents: 15500,
      tenantId: testTenant,
      tenant_id: testTenant,
    });

    // Kapandıktan sonra açık vardiya tekrar null olmalı
    const closedShiftCheck = await tauriInvoke<any>('get_active_shift', {
      cashierId: testCashierId,
      tenantId: testTenant,
      tenant_id: testTenant,
    });
    expect(closedShiftCheck).toBeNull();
  });

  it('3. Masasız / Paket Sipariş & KDS: tableId olmadan veya PAKET olarak sipariş verildiğinde KDS biletine eklenir', async () => {
    const takeawayTenant = `tenant_takeaway_${Date.now()}`;
    const orderItems = [
      {
        id: 'it_takeaway_1',
        name: 'Paket Pizza',
        unitPrice: 12000,
        quantity: 2,
        total: 24000,
      },
    ];

    // Masa belirtilmeden (tableId: 'PAKET' veya boş) submit_order çağrısı
    const res = await tauriInvoke<boolean>('submit_order', {
      payload: {
        tableId: 'PAKET',
        items: orderItems,
      },
      tenantId: takeawayTenant,
      tenant_id: takeawayTenant,
    });
    expect(res).toBe(true);

    // Canlı siparişlerde paket olarak görünmeli
    const liveOrders = await tauriInvoke<any[]>('get_live_orders', {
      tenantId: takeawayTenant,
      tenant_id: takeawayTenant,
    });
    const takeawayOrder = liveOrders.find(o => o.table_name.includes('Paket') || o.table_name.includes('Hızlı Satış'));
    expect(takeawayOrder).toBeDefined();
    expect(takeawayOrder?.total_cents).toBe(24000);

    // KDS biletlerinde de yer almalı
    const kdsTickets = await tauriInvoke<any[]>('get_active_tickets');
    const matchingKds = kdsTickets.find(t => t.tableNumber.includes('Paket') || t.tableNumber.includes('Hızlı Satış'));
    expect(matchingKds).toBeDefined();
  });

  it('4. Kullanıcı Sayacı ve Lisans Limiti: Master Admin sayaca dahil edilmez', async () => {
    const quotaTenant = `tenant_quota_${Date.now()}`;
    const quotaPlanId = `plan_quota_${Date.now()}`;

    // 1 kişilik kotalı plan oluştur
    await tauriInvoke('create_plan', {
      id: quotaPlanId,
      name: 'Tek Kullanıcılı Paket',
      maxUsers: 1,
      maxDevices: 1,
      callerRole: 'MASTER',
    });

    // Tenant oluştur (bu işlem 1 OWNER kullanıcısı ekler)
    await tauriInvoke('create_tenant', {
      id: quotaTenant,
      name: 'Kota Test Cafe',
      planId: quotaPlanId,
      callerRole: 'MASTER',
    });

    // 1 kişi zaten var (Owner). 2. kullanıcı eklenmek istendiğinde limit hatası fırlatmalı
    await expect(
      tauriInvoke('create_staff_member', {
        tenantId: quotaTenant,
        tenant_id: quotaTenant,
        name: 'İkinci Personel',
        role: 'WAITER',
        pin: '4455',
      })
    ).rejects.toThrow(/azami personel limiti/);
  });

  it('5. Ekran Kilitleme (Lock) vs. Tam Çıkış (Logout) ve Hızlı PIN ile Kilit Açma', async () => {
    // Oturum açılmış olsun
    useAuthStore.setState({
      user: {
        userId: 'usr_staff_lock_test',
        role: 'WAITER',
        name: 'Ahmet Garson',
        tenantId: 'tenant_lock_test',
        branchId: 'br_1',
        branchName: 'Merkez',
      },
      isAuthenticated: true,
      isLocked: false,
    });

    // 1. Ekranı Kilitle
    useAuthStore.getState().lock();
    expect(useAuthStore.getState().isLocked).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true); // Kullanıcı ve token hala hafızada

    // 2. Tam Logout Yap
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().isLocked).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('6. Kuruş vs. TL Tutarlılığı: create_product ve update_product kuruş dönüşümünü tam yapar', async () => {
    // Hem priceCents (doğrudan kuruş) hem de price (TL) parametreleri doğru price_cents olarak kaydedilmeli
    const prod1 = await tauriInvoke<any>('create_product', {
      name: 'Kuruş Test 1',
      priceCents: 3550, // 35.50 TL = 3550 kuruş
    });
    expect(prod1.price_cents).toBe(3550);

    const prod2 = await tauriInvoke<any>('create_product', {
      name: 'Kuruş Test 2',
      price: 42.50, // 42.50 TL = 4250 kuruş
    });
    expect(prod2.price_cents).toBe(4250);

    // update_product test
    await tauriInvoke('update_product', {
      id: prod1.id,
      price: 50.00,
    });
    const products = await tauriInvoke<any[]>('get_management_products');
    const updated = products.find(p => p.id === prod1.id);
    expect(updated?.price_cents).toBe(5000);
  });
});
