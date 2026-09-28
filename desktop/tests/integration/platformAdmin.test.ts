import { describe, it, expect } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

describe('Platform / Master Admin IPC & Module Integration Tests', () => {
  const masterRole = 'SuperAdmin';

  it('1. get_tenants: Mevcut kiracıları listeler', async () => {
    const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    expect(Array.isArray(tenants)).toBe(true);
  });

  it('2. create_tenant: Yeni müşteri oluşturur ve modülleri bağlar', async () => {
    const testTenantId = `tenant_test_${Date.now()}`;
    const newTenant = await tauriInvoke<any>('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Test Gourmet Cafe & Bistro',
      modules: ['core', 'inventory'],
      contactPerson: 'Deniz Aksoy',
      email: 'deniz@testbistro.com',
      phone: '+90 555 111 2233',
      taxId: '3456789012',
      taxOffice: 'Kadıköy',
      address: 'Moda Cad. No: 12',
    });

    expect(newTenant).toBeDefined();
    expect(newTenant.id).toBe(testTenantId);
    expect(newTenant.name).toBe('Test Gourmet Cafe & Bistro');
    expect(newTenant.status?.toUpperCase()).toBe('ACTIVE');

    // Listede göründüğünü doğrula
    const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    const found = tenants.find(t => t.id === testTenantId);
    expect(found).toBeDefined();
    expect(found?.email).toBe('deniz@testbistro.com');
    expect(found?.tax_id).toBe('3456789012');
    expect(found?.tax_office).toBe('Kadıköy');
    expect(found?.address).toBe('Moda Cad. No: 12');
  });

  it('3. update_tenant: İşletme bilgilerini günceller', async () => {
    const testTenantId = `tenant_upd_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Eski İsim Cafe',
      contactPerson: 'Eski Yetkili',
    });

    const updated = await tauriInvoke<any>('update_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Yeni İsim Bistro',
      contactPerson: 'Yeni Yetkili',
      taxId: '9988776655',
    });

    expect(updated).toBeDefined();
    expect(updated.name).toBe('Yeni İsim Bistro');
    expect(updated.contact_person).toBe('Yeni Yetkili');
    expect(updated.tax_id).toBe('9988776655');
  });

  it('4. delete_staff_member: usr_master Master Admin kullanıcısının silinmesini engeller', async () => {
    await expect(
      tauriInvoke('delete_staff_member', {
        callerRole: masterRole,
        actorRole: masterRole,
        staffId: 'usr_master',
      })
    ).rejects.toThrow(/Master Admin/i);
  });

  it('5. suspend_tenant & activate_tenant: Kiracının aktiflik durumunu günceller', async () => {
    const testTenantId = `tenant_toggle_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Toggle Test Cafe',
      modules: ['core']
    });

    // Askıya al
    const suspended = await tauriInvoke<any>('suspend_tenant', {
      callerRole: masterRole,
      tenantId: testTenantId,
      reason: 'Fatura ödenmedi'
    });
    expect(suspended.status.toUpperCase()).toBe('SUSPENDED');

    let tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    expect(tenants.find(t => t.id === testTenantId)?.status.toUpperCase()).toBe('SUSPENDED');

    // Tekrar aktifleştir
    const activated = await tauriInvoke<any>('activate_tenant', {
      callerRole: masterRole,
      tenantId: testTenantId
    });
    expect(activated.status.toUpperCase()).toBe('ACTIVE');

    tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    expect(tenants.find(t => t.id === testTenantId)?.status.toUpperCase()).toBe('ACTIVE');
  });

  it('6. update_tenant_modules: Abonelik modüllerini değiştirme', async () => {
    const testTenantId = `tenant_sub_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Subscription Test Restoran',
      modules: ['core']
    });

    await tauriInvoke<any>('update_tenant_modules', {
      callerRole: masterRole,
      tenantId: testTenantId,
      modules: ['core', 'inventory', 'kds']
    });

    const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    const tenant = tenants.find(t => t.id === testTenantId);
    expect(tenant).toBeDefined();
    expect(tenant?.modules).toContain('inventory');
    expect(tenant?.modules).toContain('kds');
  });

  it('7. get_devices, register_device & record_device_heartbeat: Cihaz kaydı ve sağlık kontrolü', async () => {
    const deviceId = `pos_dev_${Date.now()}`;
    const registered = await tauriInvoke<any>('register_device', {
      callerRole: masterRole,
      deviceId,
      deviceType: 'POS_MAIN',
      tenantId: 'DEFAULT_TENANT'
    });

    expect(registered).toBeDefined();
    expect(registered.id).toBe(deviceId);

    // Heartbeat gönder
    const heartbeat = await tauriInvoke<any>('record_device_heartbeat', {
      callerRole: masterRole,
      deviceId,
      tenantId: 'DEFAULT_TENANT'
    });
    expect(heartbeat.success).toBe(true);

    const devices = await tauriInvoke<any[]>('get_devices', { callerRole: masterRole });
    const foundDev = devices.find(d => d.id === deviceId);
    expect(foundDev).toBeDefined();
    expect(foundDev?.status).toBe('online');
  });

  it('7. get_global_users & get_platform_audit_logs: Kullanıcı listesi ve denetim kayıtları', async () => {
    const users = await tauriInvoke<any[]>('get_global_users', { callerRole: masterRole });
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users.some(u => u.id === 'usr_master')).toBe(true);

    const logs = await tauriInvoke<any[]>('get_platform_audit_logs', { callerRole: masterRole });
    expect(Array.isArray(logs)).toBe(true);
  });



  it('10. IT Diagnostic & Remote Session: Kriptografik bütünlük, uzaktan oturum ve IT müdahale araçlarını doğrular', async () => {
    // A. SHA-256 Kriptografik Bütünlük Doğrulama
    const integrityRes = await tauriInvoke<{ isValid: boolean; verifiedCount: number; algorithm: string }>('verify_audit_ledger_integrity', {});
    expect(integrityRes.isValid).toBe(true);
    expect(integrityRes.verifiedCount).toBeGreaterThanOrEqual(0);
    expect(integrityRes.algorithm).toContain('SHA-256');

    // B. Müşteri Ekranına Canlı Uzaktan Bağlantı (Remote Session / Impersonation)
    const sessionRes = await tauriInvoke<{ success: boolean; sessionId: string; mode: string }>('create_remote_session', {
      tenantId: 'tenant_sample_01',
      targetView: 'POS',
      targetRole: 'OWNER',
      mode: 'INTERACTIVE',
    });
    expect(sessionRes.success).toBe(true);
    expect(sessionRes.sessionId).toBeDefined();
    expect(sessionRes.mode).toBe('INTERACTIVE');

    // C. IT Action Toolkit Komutları (DIAGNOSTIC_PING, CLEAR_CACHE, FORCE_RESYNC, FORCE_LOGOUT)
    const pingRes = await tauriInvoke<{ success: boolean; pingMs?: number }>('execute_it_action', {
      actionType: 'DIAGNOSTIC_PING',
      tenantId: 'tenant_sample_01',
    });
    expect(pingRes.success).toBe(true);
    expect(pingRes.pingMs).toBeGreaterThan(0);

    const resyncRes = await tauriInvoke<{ success: boolean; message: string }>('execute_it_action', {
      actionType: 'FORCE_RESYNC',
      tenantId: 'tenant_sample_01',
    });
    expect(resyncRes.success).toBe(true);
    expect(resyncRes.message).toContain('senkronizasyon');

    // D. Yapılan IT operasyonlarının platform denetim defterine yazıldığını doğrula
    const logs = await tauriInvoke<any[]>('get_platform_audit_logs', { callerRole: 'MASTER' });
    const remoteLog = logs.find(l => l.action && l.action.includes('REMOTE_SESSION_ATTACH'));
    const itActionLog = logs.find(l => l.action && l.action.includes('IT_OPERATIONAL_COMMAND: FORCE_RESYNC'));

    expect(remoteLog).toBeDefined();
    expect(remoteLog.tenantId).toBe('tenant_sample_01');
    expect(itActionLog).toBeDefined();
    expect(itActionLog.hash).toBeDefined();
  });
});
