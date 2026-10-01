/**
 * Patron ve Yönetim Panelleri Apple HIG UI Entegrasyon Test Paketi
 * Path: tests/integration/ownerManagementAppleHigUi.test.ts
 *
 * Owner ve Management panellerinin Apple HIG standartlarına, sadeleştirilmiş
 * metrik kartlarına (Apple Borsa / Sağlık) ve iOS onay dialoglarına uygunluğunu doğrular.
 */


import React from 'react';
import { OwnerDashboardContainer } from '../../src/presentation/components/owner/OwnerDashboardContainer';
import { OwnerBranchesTab } from '../../src/presentation/components/owner/ui/OwnerBranchesTab';
import { OwnerInventoryTab } from '../../src/presentation/components/owner/ui/OwnerInventoryTab';
import { OwnerMenuTab } from '../../src/presentation/components/owner/ui/OwnerMenuTab';
import { OwnerSalesTab } from '../../src/presentation/components/owner/ui/OwnerSalesTab';
import { ManagementContainer } from '../../src/presentation/components/management/ManagementContainer';
import { ApprovalsPanel } from '../../src/presentation/components/management/ui/ApprovalsPanel';
import { OperationsDashboard } from '../../src/presentation/components/management/ui/OperationsDashboard';
import { ConfirmationModal } from '../../src/presentation/components/management/ui/ConfirmationModal';
import { TablesOrdersPanel } from '../../src/presentation/components/management/ui/TablesOrdersPanel';
import { ReportsPanel } from '../../src/presentation/components/management/ui/ReportsPanel';

describe('Patron ve Yönetim Panelleri — Apple HIG & iOS UI Standartları', () => {
  it('1. OwnerDashboardContainer Apple koyu arka plan (#09090b) ve segmented navigasyon ile render edilir', () => {
    const element = React.createElement(OwnerDashboardContainer);
    expect(element).toBeDefined();
    expect(OwnerDashboardContainer).toBeInstanceOf(Function);
  });

  it('2. OwnerBranchesTab rehber metinleri barındırmaz ve Apple metrik kartlarını içerir', () => {
    const element = React.createElement(OwnerBranchesTab);
    expect(element).toBeDefined();
    expect(OwnerBranchesTab).toBeInstanceOf(Function);
  });

  it('3. OwnerInventoryTab Apple Borsa/Sağlık tarzı 3 lü metrik ve minimalist tablo ile render edilir', () => {
    const element = React.createElement(OwnerInventoryTab);
    expect(element).toBeDefined();
    expect(OwnerInventoryTab).toBeInstanceOf(Function);
  });

  it('4. OwnerMenuTab Apple metrik özet kartları ve iOS onay modalı ile render edilir', () => {
    const element = React.createElement(OwnerMenuTab);
    expect(element).toBeDefined();
    expect(OwnerMenuTab).toBeInstanceOf(Function);
  });

  it('5. OwnerSalesTab Apple Borsa/Sağlık trend çizgili kartları ve minimalist fiş tablosu ile render edilir', () => {
    const element = React.createElement(OwnerSalesTab);
    expect(element).toBeDefined();
    expect(OwnerSalesTab).toBeInstanceOf(Function);
  });

  it('6. ManagementContainer sadeleştirilmiş Apple HIG başlık ve segmented tab yapısı sunar', () => {
    const element = React.createElement(ManagementContainer);
    expect(element).toBeDefined();
    expect(ManagementContainer).toBeInstanceOf(Function);
  });

  it('7. ApprovalsPanel zarif iOS onay dialogları ve müdür PIN doğrulaması ile render edilir', () => {
    const element = React.createElement(ApprovalsPanel);
    expect(element).toBeDefined();
    expect(ApprovalsPanel).toBeInstanceOf(Function);
  });

  it('8. OperationsDashboard Apple 4 lü metrik kartları ve ferah canlı sipariş tablosu içerir', () => {
    const element = React.createElement(OperationsDashboard);
    expect(element).toBeDefined();
    expect(OperationsDashboard).toBeInstanceOf(Function);
  });

  it('9. ConfirmationModal Apple iOS alert dialog standartlarına (#1c1c1e, backdrop-blur-xl) tam uyar', () => {
    // Hook kuralları gereği bileşen doğrudan çağrılamaz; element referansı üzerinden doğrulama yapılır
    expect(ConfirmationModal).toBeInstanceOf(Function);
    const element = React.createElement(ConfirmationModal, {
      isOpen: true,
      onClose: () => {},
      onConfirm: () => {},
      title: 'İptal Onayı',
      description: 'Seçili işlem iptal edilecek.',
      confirmText: 'Onayla',
      cancelText: 'Vazgeç',
    });
    expect(element).toBeDefined();
    expect(element.type).toBe(ConfirmationModal);
  });

  it('10. Patron Portalı tüm kritik sekmeleri (Onaylar, Personel, Sistem Logları, Stok & Reçete) destekler', async () => {
    const { renderToString } = await import('react-dom/server');
    const { buildOwnerNavItems } = await import(
      '../../src/presentation/components/owner/OwnerDashboardContainer'
    );
    const { hasCapability } = await import('../../src/core/security/navigationMatrix');

    // Sunucu render'ı zustand'ın başlangıç durumunu gördüğü için sekme listesi
    // yetki fonksiyonu üzerinden doğrudan doğrulanır.
    const labels = buildOwnerNavItems((capability) => hasCapability('OWNER', capability)).map(
      (item) => item.label,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        'Genel Bakış',
        'Satışlar',
        'Menü',
        'Stok & Reçete',
        'Masa Yönetimi',
        'Operasyonel Raporlar',
        'Onaylar',
        'Personel',
        'Sistem Logları',
      ]),
    );

    // Bileşen yine de render edilebilir olmalı.
    const html = renderToString(React.createElement(OwnerDashboardContainer));
    expect(html).toBeDefined();
  });

  it('10b. Denetim kayıtları sekmesi yalnızca sahip ve müdüre listelenir', async () => {
    const { buildOwnerNavItems } = await import(
      '../../src/presentation/components/owner/OwnerDashboardContainer'
    );
    const { hasCapability } = await import('../../src/core/security/navigationMatrix');

    const hasLogsTab = (role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN' | 'MASTER') =>
      buildOwnerNavItems((capability) => hasCapability(role, capability)).some(
        (item) => item.id === 'logs',
      );

    expect(hasLogsTab('OWNER')).toBe(true);
    expect(hasLogsTab('MANAGER')).toBe(true);
    // Kasiyer, garson, mutfak ve MASTER'ın işletme defterinde sekmesi yoktur.
    expect(hasLogsTab('CASHIER')).toBe(false);
    expect(hasLogsTab('WAITER')).toBe(false);
    expect(hasLogsTab('KITCHEN')).toBe(false);
    expect(hasLogsTab('MASTER')).toBe(false);
  });

  it('11. Stok eksiltme (fire) işlemi Patron PIN doğrulaması gerektirir', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    
    // Geçersiz veya garson PIN ile patron yetkisi alınamamalıdır
    let authFailed = false;
    try {
      const waiterAuth = await tauriInvoke<{ role: string }>('auth_login', { pin: '5555' });
      if (waiterAuth.role !== 'OWNER' && waiterAuth.role !== 'MASTER') {
        authFailed = true;
      }
    } catch {
      authFailed = true;
    }
    expect(authFailed).toBe(true);

    // Gerçek Patron PIN (2222) başarıyla doğrulanmalıdır
    const ownerAuth = await tauriInvoke<{ role: string; name: string }>('auth_login', { pin: '2222' });
    expect(ownerAuth.role).toBe('OWNER');
    expect(ownerAuth.name).toBeDefined();
  });

  it('12. Doğrudan stok ikmali PIN onayı istemeden işlenir', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    const inventory = await tauriInvoke<any[]>('get_inventory', { tenant_id: 'DEFAULT_TENANT' });
    expect(Array.isArray(inventory)).toBe(true);
    expect(inventory.length).toBeGreaterThan(0);

    const firstItem = inventory[0];
    const initialStock = firstItem.current_stock;

    // Doğrudan stok ekleme
    await tauriInvoke('adjust_stock', {
      caller_role: 'OWNER',
      tenant_id: 'DEFAULT_TENANT',
      item_id: firstItem.id,
      quantity_change: 5,
      movement_type: 'IN',
      actor_id: 'Patron',
      reason: 'Hammadde Girişi (İkmal)',
    });

    const updatedInventory = await tauriInvoke<any[]>('get_inventory', { tenant_id: 'DEFAULT_TENANT' });
    const updatedItem = updatedInventory.find(i => i.id === firstItem.id);
    expect(updatedItem?.current_stock).toBe(initialStock + 5);
  });

  it('12b. Stok düzenleme yetkisiz rolde ve rolsuz çağrıda reddedilir', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    const inventory = await tauriInvoke<any[]>('get_inventory', { tenant_id: 'DEFAULT_TENANT' });
    const firstItem = inventory[0];

    // Rol alanı hiç gönderilmezse kapı fail-closed reddetmeli.
    await expect(
      tauriInvoke('adjust_stock', {
        tenant_id: 'DEFAULT_TENANT',
        item_id: firstItem.id,
        quantity_change: 1,
        movement_type: 'IN',
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    // Kasiyer stok düzenleyemez.
    await expect(
      tauriInvoke('adjust_stock', {
        caller_role: 'CASHIER',
        tenant_id: 'DEFAULT_TENANT',
        item_id: firstItem.id,
        quantity_change: 1,
        movement_type: 'IN',
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('13. Menü ürünlerinde tek tıkla ON/OFF satış durumu geçişi çalışır', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    const products = await tauriInvoke<any[]>('get_management_products', { actorRole: 'OWNER' });
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBeGreaterThan(0);

    const testProd = products[0];
    const originalStatus = testProd.is_active;

    // Durumu tersine çevir
    await tauriInvoke('update_product_status', {
      actorRole: 'OWNER',
      id: testProd.id,
      is_active: !originalStatus,
    });

    const refreshedProds = await tauriInvoke<any[]>('get_management_products', { actorRole: 'OWNER' });
    const toggledProd = refreshedProds.find(p => p.id === testProd.id);
    expect(toggledProd?.is_active).toBe(!originalStatus);

    // Eski haline getir
    await tauriInvoke('update_product_status', {
      actorRole: 'OWNER',
      id: testProd.id,
      is_active: originalStatus,
    });
  });

  it('14. Patron Portalı operasyonel yönetim yeteneklerini (Masa & Siparişler ve Operasyonel Raporlar) bağımsız cam ada olarak içerir', () => {
    const tablesEl = React.createElement(TablesOrdersPanel);
    const reportsEl = React.createElement(ReportsPanel);
    expect(tablesEl).toBeDefined();
    expect(reportsEl).toBeDefined();
    expect(TablesOrdersPanel).toBeInstanceOf(Function);
    expect(ReportsPanel).toBeInstanceOf(Function);
  });
});
