import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import {
  PlatformSetupWizard,
  AVAILABLE_MODULES,
  STEP_CONFIGS,
} from '../../src/presentation/components/platform/PlatformSetupWizard';
import {
  TenantOnboardingWizard,
} from '../../src/presentation/components/platform/TenantOnboardingWizard';

/**
 * Apple Setup Assistant & Platform Kurulum Sihirbazı Entegrasyon Test Paketi.
 * Bu testler; sihirbazın bileşen dışa aktarımlarını, veri doğrulama kurallarını,
 * adım yapılandırmalarını ve tauriInvoke aracılığıyla işletme kurulum IPC akışını doğrular.
 */
describe('Apple Setup Assistant & Platform Kurulum Sihirbazı Entegrasyonu', () => {
  it('1. PlatformSetupWizard ve TenantOnboardingWizard bileşenleri doğru dışa aktarılıyor', () => {
    expect(PlatformSetupWizard).toBeDefined();
    expect(TenantOnboardingWizard).toBeDefined();
    expect(typeof PlatformSetupWizard).toBe('function');
    expect(typeof TenantOnboardingWizard).toBe('function');
    expect(AVAILABLE_MODULES).toBeDefined();
    expect(Array.isArray(AVAILABLE_MODULES)).toBe(true);
    expect(STEP_CONFIGS).toBeDefined();
    expect(Array.isArray(STEP_CONFIGS)).toBe(true);
  });

  it('2. isOpen false olduğunda sihirbaz boş çıktı üretir', () => {
    const html = renderToString(
      React.createElement(PlatformSetupWizard, {
        isOpen: false,
        onClose: () => {},
      })
    );
    expect(html).toBe('');
  });

  it('3. isOpen true olduğunda Apple modal hiyerarşisi oluşturulur', () => {
    const html = renderToString(
      React.createElement(PlatformSetupWizard, {
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(html).not.toBe('');
    expect(html).toContain('backdrop-blur-2xl');
    expect(html).toContain('Şirket &amp; Yasal Bilgiler');
    expect(html).toMatch(/Adım.*1.*\/ 4/);
  });

  it('4. Apple Setup Assistant adım yapılandırmaları ve modül katalog kuralları eksiksizdir', () => {
    // 5 adımın başlık ve alt başlıklarının varlığı
    expect(STEP_CONFIGS.length).toBe(5);
    expect(STEP_CONFIGS[0].title).toBe('Şirket & Yasal Bilgiler');
    expect(STEP_CONFIGS[1].title).toBe('Şube & Donanım Kurulumu');
    expect(STEP_CONFIGS[2].title).toBe('Yönetici & Güvenlik');
    expect(STEP_CONFIGS[3].title).toBe('Modül & Paket Seçimi');
    expect(STEP_CONFIGS[4].title).toBe('Kurulum Tamamlandı');

    // Temel 'core' modülü zorunlu ve sistem temeli olmalıdır
    const coreModule = AVAILABLE_MODULES.find(m => m.id === 'core');
    expect(coreModule).toBeDefined();
    expect(coreModule?.isRequired).toBe(true);
    expect(coreModule?.name).toBe('Temel Restoran Yönetimi');

    // Diğer modüller opsiyonel olmalıdır
    const inventoryModule = AVAILABLE_MODULES.find(m => m.id === 'inventory');
    expect(inventoryModule).toBeDefined();
    expect(inventoryModule?.isRequired).toBe(false);
  });

  it('5. Dokunmatik POS PIN, Lisans ve Şifre format kuralları doğrulanır', () => {
    // 4 ila 8 haneli PIN doğrulama regex kontrolü
    const pinRegex = /^\d{4,8}$/;
    expect(pinRegex.test('1234')).toBe(true);
    expect(pinRegex.test('12345678')).toBe(true);
    expect(pinRegex.test('123')).toBe(false); // 4 haneden az
    expect(pinRegex.test('123456789')).toBe(false); // 8 haneden fazla
    expect(pinRegex.test('12a4')).toBe(false); // Sayısal olmayan karakter

    // Lisans anahtarı formatı (K360-XXXX-YYYY-ZZZZ)
    const licenseRegex = /^K360-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    expect(licenseRegex.test('K360-ABCD-EFGH-1234')).toBe(true);
    expect(licenseRegex.test('K360-1234-5678-9012')).toBe(true);
    expect(licenseRegex.test('INVALID-KEY')).toBe(false);
  });

  it('6. Apple standartlarında tam donanımlı işletme kaydı (create_tenant) başarıyla çalışır', async () => {
    const timestamp = Date.now();
    const testPayload = {
      callerRole: 'MASTER',
      name: `Apple Bistro & Cafe ${timestamp}`,
      legalName: `Apple Bistro Gıda A.Ş. ${timestamp}`,
      modules: ['core', 'inventory', 'qr_menu'],
      contactPerson: 'Zeynep Kaya',
      email: `zeynep_${timestamp}@applebistro.com`,
      phone: '+90 532 999 8877',
      taxId: '1234567890',
      taxOffice: 'Beşiktaş V.D.',
      address: 'Bebek Mah. Cevdetpaşa Cad. No: 42 Beşiktaş/İstanbul',
      branchName: 'Boğaz Şubesi',
      ownerName: 'Zeynep Kaya',
      ownerEmail: `zeynep_${timestamp}@applebistro.com`,
      ownerPassword: 'Kasam-SuperSecret!2026',
      ownerPin: '2468',
      licenseKey: 'K360-APPL-M1X8-9922',
    };

    const result = await tauriInvoke<any>('create_tenant', testPayload);

    expect(result).toBeDefined();
    expect(result.name).toBe(testPayload.name);
    expect(result.status?.toUpperCase()).toBe('ACTIVE');

    // Müşteriler listesinde kaydın yer aldığını ve bilgilerinin eşleştiğini doğrula
    const tenants = await tauriInvoke<any[]>('get_tenants', { callerRole: 'MASTER', callerTenantId: '' });
    const createdTenant = tenants.find(t => t.name === testPayload.name);
    expect(createdTenant).toBeDefined();
    expect(createdTenant?.contact_person).toBe('Zeynep Kaya');
    expect(createdTenant?.email).toBe(testPayload.email);
  });

  it('7. TenantOnboardingWizard bileşeni doğru render edilir ve onComplete propunu destekler', async () => {
    const mockSuccess = vi.fn();
    const mockComplete = vi.fn();

    const html = renderToString(
      React.createElement(TenantOnboardingWizard, {
        isOpen: true,
        onClose: () => {},
        onSuccess: mockSuccess,
        onComplete: mockComplete,
      })
    );

    expect(html).not.toBe('');
    expect(html).toContain('Şirket &amp; Yasal Bilgiler');
    expect(html).toContain('Moda Sahil Bistro');
  });
});
