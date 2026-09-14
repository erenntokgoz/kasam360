import { describe, it, expect } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';

describe('Platform / Master Admin IPC & Module Integration Tests', () => {
  const masterRole = 'SuperAdmin';

  it('1. get_plans: Tüm abonelik paketlerini eksiksiz çeker', async () => {
    const plans = await tauriInvoke<any[]>('get_plans', { callerRole: masterRole });
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const planNames = plans.map(p => p.name);
    expect(planNames).toContain('Başlangıç (Starter)');
    expect(planNames).toContain('Profesyonel (Pro)');
    expect(planNames).toContain('Enterprise Plus');
  });

  it('2. get_tenants: Mevcut kiracıları listeler', async () => {
    const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: masterRole });
    expect(Array.isArray(tenants)).toBe(true);
  });

  it('3. create_tenant: Yeni müşteri oluşturur ve plana bağlar', async () => {
    const testTenantId = `tenant_test_${Date.now()}`;
    const newTenant = await tauriInvoke<any>('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Test Gourmet Cafe & Bistro',
      planId: 'plan_pro',
      contactPerson: 'Deniz Aksoy',
      email: 'deniz@testbistro.com',
      phone: '+90 555 111 2233'
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
  });

  it('4. suspend_tenant & activate_tenant: Kiracının aktiflik durumunu günceller', async () => {
    const testTenantId = `tenant_toggle_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Toggle Test Cafe',
      planId: 'plan_starter'
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

  it('5. update_tenant_subscription: Abonelik planı değiştirme ve süre uzatma', async () => {
    const testTenantId = `tenant_sub_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: testTenantId,
      name: 'Subscription Test Restoran',
      planId: 'plan_starter'
    });

    const updated = await tauriInvoke<any>('update_tenant_subscription', {
      callerRole: masterRole,
      tenantId: testTenantId,
      planId: 'plan_enterprise',
      addDays: 30
    });

    expect(updated.plan_id).toBe('plan_enterprise');

    const subs = await tauriInvoke<any[]>('get_subscriptions', { callerRole: masterRole });
    const sub = subs.find(s => s.tenant_id === testTenantId);
    expect(sub).toBeDefined();
    expect(sub?.plan_id).toBe('plan_enterprise');
  });

  it('6. get_devices, register_device & record_device_heartbeat: Cihaz kaydı ve sağlık kontrolü', async () => {
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

  it('8. create_plan, update_plan & delete_plan: Paket yönetim CRUD ve bağlı kullanıcı senkronizasyonu', async () => {
    const testPlanId = `plan_custom_${Date.now()}`;
    
    // Yeni Paket Oluşturma
    const createdPlan = await tauriInvoke<any>('create_plan', {
      callerRole: masterRole,
      id: testPlanId,
      name: 'Özel Bistro Paketi',
      monthlyPriceCents: 75000,
      maxDevices: 4,
      maxUsers: 8,
      maxBranches: 2,
      badge: 'Yeni Özel',
      features: ['Hızlı POS', 'KDS Desteği'],
    });

    expect(createdPlan).toBeDefined();
    expect(createdPlan.id).toBe(testPlanId);
    expect(createdPlan.name).toBe('Özel Bistro Paketi');
    expect(createdPlan.max_devices).toBe(4);
    expect(createdPlan.max_users).toBe(8);

    // Listede yer aldığını doğrula
    let plans = await tauriInvoke<any[]>('get_plans', {});
    expect(plans.some(p => p.id === testPlanId)).toBe(true);

    // Paket Düzenleme (Kullanıcı limiti ve fiyat artırma)
    const updatedPlan = await tauriInvoke<any>('update_plan', {
      callerRole: masterRole,
      id: testPlanId,
      name: 'Özel Bistro Paketi V2',
      monthlyPriceCents: 85000,
      maxDevices: 6,
      maxUsers: 12,
      maxBranches: 3,
      badge: 'Popüler Seçim',
      features: ['Hızlı POS', 'KDS Desteği', 'Çoklu Şube'],
    });

    expect(updatedPlan.name).toBe('Özel Bistro Paketi V2');
    expect(updatedPlan.max_users).toBe(12);
    expect(updatedPlan.monthly_price_cents).toBe(85000);

    // Kiracı oluşturup bu plana bağla
    const tenantId = `tenant_plan_test_${Date.now()}`;
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: tenantId,
      name: 'Plan Bağlantı Test Restoranı',
      planId: testPlanId,
    });

    // Aktif abonesi olan paketi silmeyi dene -> Hata vermeli (koruma)
    await expect(
      tauriInvoke('delete_plan', { callerRole: masterRole, id: testPlanId })
    ).rejects.toThrow();

    // Kiracıyı başka bir plana aktar
    await tauriInvoke('update_tenant_subscription', {
      callerRole: masterRole,
      tenantId: tenantId,
      planId: 'plan_starter',
      addDays: 30,
    });

    // Artık abonesi kalmayan paketi sil
    const deleteResult = await tauriInvoke<any>('delete_plan', {
      callerRole: masterRole,
      id: testPlanId,
    });
    expect(deleteResult.success).toBe(true);

    // Listeden kalktığını doğrula
    plans = await tauriInvoke<any[]>('get_plans', {});
    expect(plans.some(p => p.id === testPlanId)).toBe(false);
  });

  it('9. Paket limit denetimi: Düzenlenen paket limitleri yeni personel/cihaz eklemeyi kısıtlar', async () => {
    // 1 kullanıcılık sıkı kuralı olan geçici paket oluştur
    const strictPlanId = `plan_strict_${Date.now()}`;
    await tauriInvoke<any>('create_plan', {
      callerRole: masterRole,
      id: strictPlanId,
      name: 'Tek Personel Deneme',
      monthlyPriceCents: 10000,
      maxDevices: 1,
      maxUsers: 1, // Sadece 1 personel
    });

    const tenantId = `tenant_strict_${Date.now()}`;
    // Tenant oluşturulurken otomatik 1 OWNER personel eklenir
    await tauriInvoke('create_tenant', {
      callerRole: masterRole,
      id: tenantId,
      name: 'Sıkı Limit Restoranı',
      planId: strictPlanId,
    });

    // 2. personeli eklemeye çalışınca limit hatası vermeli
    await expect(
      tauriInvoke('create_staff_member', {
        callerRole: masterRole,
        tenantId: tenantId,
        name: 'Ek Garson',
        role: 'WAITER',
        pin: '9876',
      })
    ).rejects.toThrow(/limit/i);

    // Paketi düzenleyip limiti artıralım (Kullanıcının talep ettiği "PAKETLERİ DÜZENLEDİĞİMDE MEVCUT KULLANICILAR DA ETKİLENSİN")
    await tauriInvoke('update_plan', {
      callerRole: masterRole,
      id: strictPlanId,
      name: 'Genişletilmiş Deneme',
      monthlyPriceCents: 20000,
      maxDevices: 5,
      maxUsers: 5, // Artık 5 personel hakkı var
    });

    // Şimdi aynı personel başarıyla eklenebilmeli
    const addedStaff = await tauriInvoke<any>('create_staff_member', {
      callerRole: masterRole,
      tenantId: tenantId,
      name: 'Ek Garson',
      role: 'WAITER',
      pin: '9876',
    });
    expect(addedStaff).toBeDefined();
    expect(addedStaff.name).toBe('Ek Garson');
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
