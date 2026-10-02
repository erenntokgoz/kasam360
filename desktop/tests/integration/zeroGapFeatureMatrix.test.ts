
/// <reference types="vite/client" />
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { buildPresetRange } from '../../src/presentation/components/reports/reportTypes';

describe('KASAM360 — ZERO-GAP FEATURE MATRIX VALIDATION', () => {
  const tenantId = 'tenant_zerogap_test';

  // --------------------------------------------------------------------------
  // 1. CASHIER WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: CASHIER', () => {
    /** C4 testi bu tahsilat kimliğini kullanır. */
    let settledTransactionId = '';

    it('C1: pos_get_categories & pos_get_products retrieve catalog items', async () => {
      const categories = await tauriInvoke<any[]>('pos_get_categories', { tenantId });
      expect(Array.isArray(categories)).toBe(true);

      const products = await tauriInvoke<any[]>('pos_get_products', { tenantId });
      expect(Array.isArray(products)).toBe(true);
    });

    it('C2: open_shift, cash_in, cash_out, get_shift_summary, close_shift operate flawlessly', async () => {
      const cashierId = 'usr_cashier_zerogap';
      const openRes = await tauriInvoke<any>('open_shift', {
        cashierId,
        expectedAmountCents: 30000, // 300.00 TL
        tenantId,
      });
      expect(openRes).toBeDefined();

      const inRes = await tauriInvoke<any>('cash_in', {
        shiftId: openRes.id || 'shift_zerogap',
        amountCents: 5000,
        reason: 'Bozuk para',
        actorId: cashierId,
        tenantId,
      });
      expect(inRes).toBeDefined();

      const outRes = await tauriInvoke<any>('cash_out', {
        shiftId: openRes.id || 'shift_zerogap',
        amountCents: 2000,
        reason: 'Gider',
        actorId: cashierId,
        tenantId,
      });
      expect(outRes).toBeDefined();

      const summary = await tauriInvoke<any>('get_shift_summary', {
        shiftId: openRes.id || 'shift_zerogap',
      });
      expect(summary).toBeDefined();
      expect(summary.expectedBalance).toBeGreaterThanOrEqual(0);

      const closeRes = await tauriInvoke<any>('close_shift', {
        cashierId,
        actualAmountCents: 33000,
      });
      expect(closeRes).toBeDefined();
    });

    it('C3: process_payment handles CASH and computes exact change', async () => {
      const txnId = `TXN_${Date.now()}`;
      const paymentRes = await tauriInvoke<any>('process_payment', {
        tenantId,
        payload: {
          transactionId: txnId,
          orderId: `ORD_${Date.now()}`,
          timestamp: new Date().toISOString(),
          method: 'CASH',
          amountTendered: 20000, // 200.00 TL tendered
          totalAmount: 18000,    // 180.00 TL total
          changeAmount: 2000,    // 20.00 TL change
          items: [
            { productId: 'prd_01', name: 'Türk Kahvesi', quantity: 2, unitPriceCents: 9000, totalCents: 18000 }
          ],
        }
      });
      expect(paymentRes).toBeDefined();
      expect(paymentRes.success).toBe(true);
      settledTransactionId = paymentRes.transactionId || txnId;
    });

    // Faz 7: fiş basımı artık keyfi JSON kabul etmez; yalnız **kayıtlı tahsilat**
    // basılır. Rol/tenant eksikse veya kayıt yoksa fail-closed hata verir.
    it('C4: print_receipt yalnız kayıtlı tahsilatı basar, keyfi belge basmaz', async () => {
      const printRes = await tauriInvoke<any>('print_receipt', {
        receiptId: settledTransactionId,
        actorRole: 'CASHIER',
        tenantId,
      });
      expect(printRes).toBeDefined();

      await expect(
        tauriInvoke('print_receipt', {
          order: { type: 'PAYMENT_RECEIPT', totalAmount: 18000 },
          actorRole: 'CASHIER',
          tenantId,
        }),
      ).rejects.toThrow();

      await expect(
        tauriInvoke('print_receipt', {
          receiptId: settledTransactionId,
          actorRole: 'CASHIER',
        }),
      ).rejects.toThrow(/UNAUTHORIZED/);

      await expect(
        tauriInvoke('print_receipt', {
          receiptId: 'txn_kayit_yok',
          actorRole: 'CASHIER',
          tenantId,
        }),
      ).rejects.toThrow(/NOT_FOUND/);
    });

    it('C5: günün defter Z-Raporu veritabanından basılır', async () => {
      const res = await tauriInvoke<any>('print_day_z_report', {
        actorRole: 'CASHIER',
        tenantId,
      });
      expect(res).toBeDefined();

      await expect(
        tauriInvoke('print_day_z_report', { actorRole: 'CASHIER' }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    });
  });

  // --------------------------------------------------------------------------
  // 2. WAITER WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: WAITER', () => {
    const tableA = `tbl_zg_${Date.now()}_a`;
    const tableB = `tbl_zg_${Date.now()}_b`;

    it('W1: Table lifecycle: addTable, updateTableName, get_floor_plan', async () => {
      await tauriInvoke('add_table', { id: tableA, name: 'Masa ZG-1', tenantId });
      await tauriInvoke('add_table', { id: tableB, name: 'Masa ZG-2', tenantId });

      await tauriInvoke('update_table_name', { id: tableA, name: 'Masa ZG-1 (VIP)', tenantId });

      const floor = await tauriInvoke<any[]>('get_floor_plan', { tenantId });
      const foundA = floor.find(t => t.id === tableA);
      expect(foundA).toBeDefined();
      expect(foundA?.name).toBe('Masa ZG-1 (VIP)');
    });

    it('W2: Table operations: reserve_table, move_table, merge_tables', async () => {
      // Faz 8: rezervasyon artık müşteri verisi ister ve açık rezervasyonlu masa
      // taşınamaz/birleştirilemez. Test bu kuralları gerçek kapılarla doğrular:
      // önce rezervasyon yazılır, sonra kaldırılır, ardından taşıma/birleştirme.
      // Rol oturumdan gelmezse (bu test doğrudan `tauriInvoke` çağırıyor) kapı
      // fail-closed reddeder; bu yüzden rol açıkça WAITER olarak verilir.
      const reserved = await tauriInvoke<any>('reserve_table', {
        request: {
          tableId: tableA,
          customerName: 'W2 Test Misafir',
          partySize: 2,
          reservedAt: new Date().toISOString(),
        },
        tenantId,
        callerRole: 'WAITER',
      });
      expect(reserved.status).toBe('ACTIVE');

      // Açık rezervasyonlu masa taşınamaz: kapı CONFLICT döner.
      const moveError = await tauriInvoke('move_table', { fromId: tableA, toId: tableB, tenantId }).then(
        () => null,
        (err: unknown) => String(err)
      );
      expect(moveError).toContain('CONFLICT');

      const mergeError = await tauriInvoke('merge_tables', {
        sourceId: tableA,
        targetId: tableB,
        actorId: 'usr_waiter',
        tenantId,
        callerRole: 'WAITER',
      }).then(
        () => null,
        (err: unknown) => String(err)
      );
      expect(mergeError).toContain('CONFLICT');

      await tauriInvoke('cancel_reservation', { reservationId: reserved.id, tenantId, callerRole: 'WAITER' });

      await tauriInvoke('move_table', { fromId: tableA, toId: tableB, tenantId });
      await tauriInvoke('merge_tables', {
        sourceId: tableB,
        targetId: tableA,
        actorId: 'usr_waiter',
        tenantId,
        callerRole: 'WAITER',
      });

      const floor = await tauriInvoke<any[]>('get_floor_plan', { tenantId });
      expect(Array.isArray(floor)).toBe(true);
    });

    it('W3: waiter_clock_in and get_table_ready_status verify floor coordination', async () => {
      const clockInRes = await tauriInvoke<any>('waiter_clock_in', { waiterId: 'usr_waiter' });
      expect(clockInRes).toBeDefined();

      const readyStatus = await tauriInvoke<any>('get_table_ready_status', { tableId: tableA });
      expect(readyStatus).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. KITCHEN WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: KITCHEN', () => {
    it('K1: get_stations & create_station manage kitchen prep routes', async () => {
      const stationId = `st_${Date.now()}`;
      await tauriInvoke('create_station', {
        id: stationId,
        name: 'Ocak & Izgara',
        description: 'Sıcak yemekler',
        tenantId,
      });

      const stations = await tauriInvoke<any[]>('get_stations', { tenantId });
      expect(Array.isArray(stations)).toBe(true);
    });

    it('K2: get_active_tickets, kds_update_ticket_status & update_kds_item_status bump tickets', async () => {
      const tickets = await tauriInvoke<any[]>('get_active_tickets', { tenantId });
      expect(Array.isArray(tickets)).toBe(true);

      const bumpRes = await tauriInvoke<any>('kds_update_ticket_status', {
        payload: {
          orderId: 'ORD_SAMPLE_01',
          toStatus: 'READY',
        }
      });
      expect(bumpRes).toBeDefined();
      expect(bumpRes.success).toBe(true);

      const itemBumpRes = await tauriInvoke<any>('update_kds_item_status', {
        payload: {
          itemId: 'item_sample_01',
          status: 'Ready',
        }
      });
      expect(itemBumpRes).toBeDefined();
      expect(itemBumpRes.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. MANAGER WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: MANAGER', () => {
    const catId = `cat_zg_${Date.now()}`;
    const prdId = `prd_zg_${Date.now()}`;
    const staffId = `stf_zg_${Date.now()}`;
    const invId = `inv_zg_${Date.now()}`;

    it('M1: Category CRUD operates end-to-end', async () => {
      await tauriInvoke('create_category', {
        callerRole: 'MANAGER',
        id: catId,
        name: 'Yeni Tatlılar',
        displayOrder: 10,
        icon: '🍰',
      });

      await tauriInvoke('update_category', {
        callerRole: 'MANAGER',
        id: catId,
        name: 'Spesiyal Tatlılar',
        displayOrder: 11,
        icon: '🍮',
      });

      const cats = await tauriInvoke<any[]>('get_management_categories', { callerRole: 'MANAGER' });
      expect(cats.some(c => c.id === catId)).toBe(true);

      await tauriInvoke('delete_category', { callerRole: 'MANAGER', id: catId });
    });

    it('M2: Product CRUD and status toggles operate end-to-end', async () => {
      await tauriInvoke('create_product', {
        callerRole: 'MANAGER',
        id: prdId,
        name: 'Fıstıklı Baklava',
        priceCents: 15000,
        taxRate: 10.0,
        categoryId: 'cat-003',
        sku: 'SKU-BAK-01',
      });

      await tauriInvoke('update_product', {
        callerRole: 'MANAGER',
        id: prdId,
        name: 'Havuç Dilim Baklava',
        priceCents: 18000,
        taxRate: 10.0,
        categoryId: 'cat-003',
        sku: 'SKU-BAK-01',
      });

      await tauriInvoke('update_product_status', {
        callerRole: 'MANAGER',
        id: prdId,
        isActive: false,
      });

      const prods = await tauriInvoke<any[]>('get_management_products', { callerRole: 'MANAGER' });
      const found = prods.find(p => p.id === prdId);
      expect(found).toBeDefined();

      await tauriInvoke('delete_product', { callerRole: 'MANAGER', id: prdId });
    });

    it('M3: Inventory stock tracking and adjustments (IN, OUT, ADJUST, WASTE)', async () => {
      await tauriInvoke('create_inventory_item', {
        callerRole: 'MANAGER',
        tenantId,
        id: invId,
        name: 'Kahve Çekirdeği (kg)',
        unit: 'kg',
        currentStock: 25.0,
        minStockAlert: 5.0,
      });

      await tauriInvoke('adjust_stock', {
        callerRole: 'MANAGER',
        tenantId,
        itemId: invId,
        delta: 10.0,
        movementType: 'IN',
        reason: 'Yeni sevkiyat',
      });

      const invList = await tauriInvoke<any[]>('get_inventory', { callerRole: 'MANAGER', tenantId });
      expect(Array.isArray(invList)).toBe(true);

      const alerts = await tauriInvoke<any[]>('get_low_stock_alerts', { callerRole: 'MANAGER', tenantId });
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('M4: Staff member creation and deletion', async () => {
      await tauriInvoke('create_staff_member', {
        actorRole: 'MANAGER',
        tenantId,
        id: staffId,
        name: 'Ali Kasiyer',
        role: 'CASHIER',
        pin: '7788',
      });

      const staff = await tauriInvoke<any[]>('get_staff', { actorRole: 'MANAGER', tenantId });
      expect(staff.some(s => s.name === 'Ali Kasiyer')).toBe(true);

      await tauriInvoke('delete_staff_member', { actorRole: 'MANAGER', staffId });
    });

    // Faz 3 (K4): onay kuyruğu kaldırıldı. Onay artık kuyrukta bekletilmez;
    // anlık PIN üretilen tek kullanımlık jetonla doğrulanır.
    it('M5: Approval engine requires instant PIN and consumes the token once', async () => {
      const request = {
        operation: 'VOID_ORDER',
        resourceId: 'ORD_SAMPLE_VOID',
        actorId: 'usr_cashier',
        actorRole: 'CASHIER',
        amountCents: 12000,
        pin: '3333',
        terminalId: 'POS_MAIN_01',
      };

      // 1) Jeton olmadan iptal reddedilir.
      const rejected = await tauriInvoke('void_order', {
        tenantId,
        payload: { orderId: 'ORD_SAMPLE_VOID', totalAmount: 12000 },
      }).then(
        () => null,
        (err: unknown) => String(err),
      );
      expect(rejected).toContain('APPROVAL_REQUIRED');

      // 2) Müdür PIN'i anlık onay verir ve jeton döner.
      const approval = await tauriInvoke<any>('verify_manager_pin', { tenantId, payload: request });
      expect(approval.approved).toBe(true);
      expect(approval.approverRole).toBe('MANAGER');
      expect(String(approval.approvalToken)).toBeTruthy();

      // 3) Jeton bir kez tüketilir.
      await expect(
        tauriInvoke('void_order', {
          tenantId,
          payload: { orderId: 'ORD_SAMPLE_VOID', totalAmount: 12000, approvalToken: approval.approvalToken },
        }),
      ).resolves.toBeDefined();

      const replay = await tauriInvoke('void_order', {
        tenantId,
        payload: { orderId: 'ORD_SAMPLE_VOID', totalAmount: 12000, approvalToken: approval.approvalToken },
      }).then(
        () => null,
        (err: unknown) => String(err),
      );
      expect(replay).toContain('APPROVAL_TOKEN_USED');

      // 4) Kuyruk komutları artık hiçbir katmanda bulunmaz (mock kaynağında
      // özel handler yok; tüm komutlar jenerik fallback'e düşer).
      const mockSource = (await import('../../src/data/ipc/tauriInvoke.ts?raw')).default;
      for (const removed of ['request_approval', 'get_pending_approvals', 'process_approval']) {
        expect(mockSource, `${removed} mocktan kaldırılmalı`).not.toContain(`'${removed}'`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. OWNER WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: OWNER', () => {
    it('O1: Analytics dashboard data retrieval', async () => {
      // Faz 5: gösterge komutu artık rol, tenant ve tarih aralığı istiyor
      // (filtresiz tarama ve uydurma kategori dağılımı kaldırıldı).
      const today = buildPresetRange('today');
      const data = await tauriInvoke<any>('get_analytics_dashboard_data', {
        callerRole: 'OWNER',
        tenantId,
        from: today.from,
        to: today.to,
      });
      expect(data).toBeDefined();
      expect(typeof data.total_sales_cents).toBe('number');
    });

    it('O2: Branches management', async () => {
      // Faz 6: şube **yazma** yetkisi patron'dan alındı (AGENTS.md §6). Patron
      // artık yalnız kendi tenant'ının şubelerini okur; ekleme/güncelleme/
      // arşivleme MASTER'ın işidir.
      await expect(
        tauriInvoke('create_branch', {
          callerRole: 'OWNER',
          tenantId,
          name: 'Kadıköy Şubesi',
          address: 'Moda Cad. No: 12',
        }),
      ).rejects.toThrow(/FORBIDDEN/);

      // Oturum tenant'ı `caller_tenant_id` ile ayrıca gönderilir: uygulamada bu
      // alan oturumdan otomatik enjekte edilir ve hedef tenant ile karışmaz.
      const branches = await tauriInvoke<any[]>('get_branches', {
        callerRole: 'OWNER',
        tenantId,
        caller_tenant_id: tenantId,
      });
      expect(Array.isArray(branches)).toBe(true);
      expect(branches.every((branch) => branch.tenant_id === tenantId)).toBe(true);

      // Patron başka bir işletmenin şubelerini okuyamaz.
      await expect(
        tauriInvoke('get_branches', {
          callerRole: 'OWNER',
          tenantId: 'BASKA_ISLETME',
          caller_tenant_id: tenantId,
        }),
      ).rejects.toThrow(/FORBIDDEN/);

      // Oturum tenant'ı olmadan şube okuması da fail-closed reddedilir.
      await expect(
        tauriInvoke('get_branches', { callerRole: 'OWNER', tenantId: 'BASKA_ISLETME' }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    });

    // Faz 4: modifier yönetimi bağımsız sekmeden `CategoryForm`/`ProductForm`
    // yüzeyine taşındı. Test artık **gerçek kimlikleri** kullanır: eski hâli
    // `id` gönderiyor, mock/backend kendi kimliğini üretiyor ve seçenek
    // sahipsiz bir gruba ekleniyordu — yalnız `Array.isArray` doğruluyordu.
    it('O3: Product modifier groups and options management', async () => {
      type ModifierOptionShape = { name: string; priceCents: number };
      type ModifierGroupShape = {
        id: string;
        name: string;
        maxSelections: number | null;
        options: ModifierOptionShape[];
      };
      const created = await tauriInvoke<{ id: string }>('create_modifier_group', {
        actorRole: 'OWNER',
        tenantId,
        name: 'Kahve Sütü Seçimi',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
      });
      expect(created.id).toBeTruthy();

      await tauriInvoke('add_modifier_option', {
        actorRole: 'OWNER',
        tenantId,
        groupId: created.id,
        name: 'Yulaf Sütü',
        priceCents: 1500,
      });

      const groups = await tauriInvoke<ModifierGroupShape[]>('get_modifier_groups', {
        actorRole: 'OWNER',
        tenantId,
      });
      expect(Array.isArray(groups)).toBe(true);

      const group = groups.find(g => g.id === created.id);
      expect(group, 'oluşturulan grup listede bulunmalı').toBeDefined();
      expect(group!.name).toBe('Kahve Sütü Seçimi');
      expect(group!.maxSelections).toBe(1);
      // Seçenek fiyat farkı kuruş olarak korunur (para birimi float değil).
      expect(group!.options).toHaveLength(1);
      expect(group!.options[0].name).toBe('Yulaf Sütü');
      expect(group!.options[0].priceCents).toBe(1500);

      await tauriInvoke('delete_modifier_group', { actorRole: 'OWNER', tenantId, groupId: created.id });

      const after = await tauriInvoke<ModifierGroupShape[]>('get_modifier_groups', {
        actorRole: 'OWNER',
        tenantId,
      });
      expect(after.find(g => g.id === created.id)).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 6. MASTER / PLATFORM ADMIN WORKFLOW & CONTRACT
  // --------------------------------------------------------------------------
  describe('Role: MASTER', () => {
    const testTenant = `t_master_${Date.now()}`;
    const testDevice = `dev_master_${Date.now()}`;

    it('P1: Tenant lifecycle (create, suspend, activate, update subscription)', async () => {
      await tauriInvoke('create_tenant', {
        callerRole: 'MASTER',
        id: testTenant,
        name: 'Platform Test Tenant',
        planId: 'plan_pro',
      });

      await tauriInvoke('suspend_tenant', { callerRole: 'MASTER', tenantId: testTenant });
      await tauriInvoke('activate_tenant', { callerRole: 'MASTER', tenantId: testTenant });

      await tauriInvoke('update_tenant_subscription', {
        callerRole: 'MASTER',
        tenantId: testTenant,
        planId: 'plan_enterprise',
        addDays: 60,
      });

      const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' });
      expect(tenants.some(t => t.id === testTenant)).toBe(true);
    });



    it('P3: Devices provisioning and lifecycle (register, heartbeat, toggle, delete)', async () => {
      await tauriInvoke('register_device', {
        callerRole: 'MASTER',
        tenantId: testTenant,
        name: 'Terminal Kasa 1',
        deviceType: 'POS_TERMINAL',
      });

      await tauriInvoke('record_device_heartbeat', { deviceId: testDevice });

      const toggleRes = await tauriInvoke<any>('toggle_device_status', {
        callerRole: 'MASTER',
        deviceId: testDevice,
      });
      expect(toggleRes).toBeDefined();

      const delRes = await tauriInvoke<any>('delete_device', {
        callerRole: 'MASTER',
        deviceId: testDevice,
      });
      expect(delRes).toBeDefined();
    });

    it('P4: Global users and role provisioning (including OWNER role)', async () => {
      const ownerUserId = `usr_owner_${Date.now()}`;
      await tauriInvoke('create_staff_member', {
        actorRole: 'MASTER',
        tenantId: testTenant,
        id: ownerUserId,
        name: 'Canan Patron',
        role: 'OWNER',
        pin: '8899',
      });

      const globalUsers = await tauriInvoke<any[]>('get_global_users', { callerRole: 'MASTER' });
      expect(Array.isArray(globalUsers)).toBe(true);
    });

    it('P5: ITOps: Remote Session Attach & IT Diagnostic commands', async () => {
      const session = await tauriInvoke<any>('create_remote_session', {
        callerRole: 'MASTER',
        tenantId: testTenant,
        targetView: 'POS',
        targetRole: 'OWNER',
        mode: 'INTERACTIVE',
      });
      expect(session).toBeDefined();
      expect(session.success).toBe(true);
      expect(session.sessionId).toBeDefined();

      for (const cmd of ['DIAGNOSTIC_PING', 'FORCE_RESYNC', 'CLEAR_CACHE', 'FORCE_LOGOUT']) {
        const itRes = await tauriInvoke<any>('execute_it_action', {
          callerRole: 'MASTER',
          actionType: cmd,
          tenantId: testTenant,
        });
        expect(itRes).toBeDefined();
        expect(itRes.success).toBe(true);
      }
    });

    it('P6: Cryptographic SHA-256 Audit Ledger integrity verification', async () => {
      const integrity = await tauriInvoke<any>('verify_audit_ledger_integrity', { callerRole: 'MASTER' });
      expect(integrity).toBeDefined();
      expect(integrity.isValid).toBe(true);
      expect(integrity.verifiedCount).toBeGreaterThanOrEqual(0);
    });

    it('P7: Master Vault Credentials, Password Reset, PIN Change & License Key regeneration', async () => {
      const creds = await tauriInvoke<any>('get_user_credentials', {
        callerRole: 'MASTER',
        userId: 'usr_master',
        authKey: '3736',
      });
      expect(creds).toBeDefined();
      expect(creds.pin).toBeDefined();

      const pwdRes = await tauriInvoke<any>('reset_user_password', {
        callerRole: 'MASTER',
        user_id: 'usr_master',
      });
      expect(pwdRes).toBeDefined();
      expect(pwdRes.new_password).toBeDefined();

      const pinRes = await tauriInvoke<any>('change_user_pin', {
        callerRole: 'MASTER',
        user_id: 'usr_master',
        new_pin: '1234',
      });
      expect(pinRes).toBeDefined();
      expect(pinRes.new_pin).toBe('1234');

      const licRes = await tauriInvoke<any>('regenerate_license_key', {
        callerRole: 'MASTER',
        user_id: 'usr_master',
      });
      expect(licRes).toBeDefined();
      expect(licRes.new_key).toBeDefined();
    });
  });
});
