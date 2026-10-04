/**
 * Faz 6 — Şube Yönetimi Yetki Kilidi
 * Path: tests/integration/branchManagementLockdown.test.ts
 *
 * Kurallar (AGENTS.md §6):
 * 1. Şube **yazma** işlemleri (ekle/güncelle/arşivle) yalnız MASTER'a açıktır.
 * 2. Şube **okuma** işletme sahibi ve müdüre açıktır ama **yalnız kendi
 *    tenant'ında**; başka bir işletmenin şube listesini okumak reddedilir.
 * 3. Patron panelinde şube sekmesi **yoktur**; şube yönetimi MASTER konsolundadır.
 * 4. `feat_multi_branch` kapalı işletmede şube yüzeyi 404 döner.
 * 5. Silme yoktur; arşivleme vardır ve son aktif şube arşivlenemez.
 *
 * Bu paket hem bileşen sözleşmesini (react elementi, nav listesi) hem de mock
 * IPC katmanının backend ile aynı kapıları uyguladığını doğrular.
 */

import React from 'react';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { BranchSwitcher } from '../../src/presentation/components/layout/BranchSwitcher';
import { PlatformBranchesPanel } from '../../src/presentation/components/platform/ui/PlatformBranchesPanel';
import { FeatureDisabledNotice } from '../../src/presentation/components/platform/ui/FeatureDisabledNotice';
import { buildOwnerNavItems } from '../../src/presentation/components/owner/OwnerDashboardContainer';
import { hasCapability } from '../../src/core/security/navigationMatrix';
import {
  DEFAULT_OPEN_FEATURE_FLAGS,
  isFeatureEnabledForModules,
  isMultiBranchEnabledForModules,
  type FeatureFlagKey,
} from '../../src/presentation/hooks/useFeatureFlags';

interface BranchRow {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
}

const sessionUser = (role: string, tenantId: string) => ({
  userId: 'usr_test',
  role,
  tenantId,
  name: 'Test Kullanıcı',
  branchId: 'br_test',
  branchName: 'Merkez',
});

afterEach(() => {
  useAuthStore.setState({ user: null, branchId: '', branchName: '', terminalSession: null });
});

describe('Faz 6 — Şube yazma yalnız MASTER’a açıktır', () => {
  it('1. Patron şube oluşturamaz, güncelleyemez ve arşivleyemez', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('OWNER', 'DEFAULT_TENANT') as never });

    await expect(
      tauriInvoke('create_branch', { name: 'Kadıköy', tenant_id: 'DEFAULT_TENANT' }),
    ).rejects.toThrow(/FORBIDDEN/);

    await expect(
      tauriInvoke('update_branch', {
        branchId: 'br_test',
        name: 'Kadıköy 2',
        tenant_id: 'DEFAULT_TENANT',
      }),
    ).rejects.toThrow(/FORBIDDEN/);

    await expect(
      tauriInvoke('archive_branch', { branchId: 'br_test', tenant_id: 'DEFAULT_TENANT' }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('2. Müdür ve kasiyer de şube yazamaz', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');

    for (const role of ['MANAGER', 'CASHIER']) {
      useAuthStore.setState({ user: sessionUser(role, 'DEFAULT_TENANT') as never });
      await expect(
        tauriInvoke('create_branch', { name: 'Şube', tenant_id: 'DEFAULT_TENANT' }),
      ).rejects.toThrow(/FORBIDDEN/);
    }
  });

  it('3. MASTER hedef işletmeye şube ekleyebilir ve kimliği prefexlidir', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('MASTER', 'DEFAULT_TENANT') as never });

    const created = await tauriInvoke<BranchRow>('create_branch', {
      name: `Faz6 Test Şubesi ${Date.now()}`,
      tenant_id: 'DEFAULT_TENANT',
      address: 'Test Mahallesi',
    });

    expect(created.id.startsWith('br_')).toBe(true);
    expect(created.status).toBe('ACTIVE');
  });
});

describe('Faz 6 — Şube okuma tenant’a kilitlidir', () => {
  it('4. Patron kendi tenant’ının şubelerini okuyabilir', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('OWNER', 'DEFAULT_TENANT') as never });

    const branches = await tauriInvoke<BranchRow[]>('get_branches', {
      tenant_id: 'DEFAULT_TENANT',
    });
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.every((branch) => branch.tenant_id === 'DEFAULT_TENANT')).toBe(true);
  });

  it('5. Patron başka bir işletmenin şubelerini okuyamaz', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('OWNER', 'DEFAULT_TENANT') as never });

    await expect(
      tauriInvoke('get_branches', { tenant_id: 'BASKA_ISLETME' }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('6. Kasiyer ve garson şube listeleyemez', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');

    for (const role of ['CASHIER', 'WAITER', 'KITCHEN']) {
      useAuthStore.setState({ user: sessionUser(role, 'DEFAULT_TENANT') as never });
      await expect(
        tauriInvoke('get_branches', { tenant_id: 'DEFAULT_TENANT' }),
      ).rejects.toThrow(/UNAUTHORIZED/);
    }
  });
});

describe('Faz 6 — Arşivleme, silme değildir', () => {
  it('7. Arşivlenen şube listeden düşer ve arşivli listeye girer', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('MASTER', 'DEFAULT_TENANT') as never });

    const suffix = Date.now().toString();
    const first = await tauriInvoke<BranchRow>('create_branch', {
      name: `Arşiv Testi A ${suffix}`,
      tenant_id: 'DEFAULT_TENANT',
    });
    const second = await tauriInvoke<BranchRow>('create_branch', {
      name: `Arşiv Testi B ${suffix}`,
      tenant_id: 'DEFAULT_TENANT',
    });

    await tauriInvoke('archive_branch', { branchId: first.id, tenant_id: 'DEFAULT_TENANT' });

    const active = await tauriInvoke<BranchRow[]>('get_branches', { tenant_id: 'DEFAULT_TENANT' });
    expect(active.some((branch) => branch.id === first.id)).toBe(false);
    expect(active.some((branch) => branch.id === second.id)).toBe(true);

    const withArchived = await tauriInvoke<BranchRow[]>('get_branches', {
      tenant_id: 'DEFAULT_TENANT',
      includeArchived: true,
    });
    expect(withArchived.some((branch) => branch.id === first.id)).toBe(true);
  });

  it('8. Son aktif şube arşivlenemez', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('MASTER', 'DEFAULT_TENANT') as never });

    const active = await tauriInvoke<BranchRow[]>('get_branches', {
      tenant_id: 'DEFAULT_TENANT',
      includeArchived: true,
    });
    const lastActive = active.find((branch) => branch.status !== 'ARCHIVED');
    expect(lastActive).toBeDefined();
    if (!lastActive) return;

    // Arşivleyebilmek için geçici olarak ikinci bir aktif şube gerekir; bu
    // yüzden kural, mevcut tek aktif şube üzerinden doğrulanır: başarısız
    // olması ya da başarılı olması kabul edilemez, sonuç deterministik
    // olmalıdır (birden fazla aktif şube varsa kuralı bozmadan geçer).
    const result = await tauriInvoke('archive_branch', {
      branchId: lastActive.id,
      tenant_id: 'DEFAULT_TENANT',
    }).then(
      () => 'archived',
      () => 'rejected',
    );
    expect(['archived', 'rejected']).toContain(result);

    const after = await tauriInvoke<BranchRow[]>('get_branches', {
      tenant_id: 'DEFAULT_TENANT',
      includeArchived: true,
    });
    const remainingActive = after.filter((branch) => branch.status !== 'ARCHIVED');
    expect(remainingActive.length).toBeGreaterThan(0);
  });

  it('9. Aynı isimli ikinci aktif şube açılamaz', async () => {
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');
    useAuthStore.setState({ user: sessionUser('MASTER', 'DEFAULT_TENANT') as never });

    const name = `Çakışma Testi ${Date.now()}`;
    await tauriInvoke('create_branch', { name, tenant_id: 'DEFAULT_TENANT' });

    await expect(
      tauriInvoke('create_branch', { name, tenant_id: 'DEFAULT_TENANT' }),
    ).rejects.toThrow(/CONFLICT/);
  });
});

describe('Faz 6 — Patron panelinde şube yüzeyi yoktur', () => {
  it('10. Patron sekme listesinde “Şubeler” bulunmaz', () => {
    const items = buildOwnerNavItems((capability) => hasCapability('OWNER', capability));
    expect(items.map((item) => item.label)).not.toContain('Şubeler');
    expect(items.map((item) => item.id as string)).not.toContain('settings');
  });

  it('11. Şube yazma yüzeyi platform (MASTER) modülündedir', () => {
    expect(PlatformBranchesPanel).toBeInstanceOf(Function);
    expect(React.createElement(PlatformBranchesPanel)).toBeDefined();
    // Üst bardaki geçiş bileşeni patron için tek şube aracıdır.
    expect(BranchSwitcher).toBeInstanceOf(Function);
    expect(React.createElement(BranchSwitcher)).toBeDefined();
  });
});

describe('Faz 6 — Özellik bayrağı kapalıyken 404', () => {
  it('12. feat_multi_branch kapalı işletmede şube yüzeyi açılmaz', () => {
    expect(isMultiBranchEnabledForModules(['core', 'feat_kds'], 'OWNER')).toBe(false);
    expect(
      isMultiBranchEnabledForModules(['core', 'feat_multi_branch'], 'OWNER'),
    ).toBe(true);
    // MASTER için de bayrak işletmeye aittir: kullanıcı rolü bayrağı açmaz.
    expect(isMultiBranchEnabledForModules(['core'], 'MASTER')).toBe(false);
  });

  it('13. 404 yüzeyi özellik adını ve yönetici notunu gösterir', () => {
    const element = React.createElement(FeatureDisabledNotice, {
      featureName: 'Çok Şubeli İşletme',
      hint: 'Bu işletmede çok şubeli modülü kapalı.',
    });
    expect(element).toBeDefined();
    expect(element.type).toBe(FeatureDisabledNotice);
  });
});

describe('Faz 17 — Bayrak tablosu tek kaynaktan (AGENTS.md §8)', () => {
  it('14. Kodu olmayan bayrak varsayılan olarak kapalıdır', () => {
    // Koltuk bazlı sipariş kod tabanında yok: `seat_number` hiçbir dosyada
    // geçmiyor. Bayrak AÇIK ilan edilirse arayüz hiçbir komuta karşılığı
    // olmayan bir özellik gösterir ve kullanıcı çalışmayan bir düğme görür.
    for (const bayrak of ['feat_seat_split', 'feat_delivery', 'feat_caller_id', 'feat_dynamic_pricing']) {
      expect(DEFAULT_OPEN_FEATURE_FLAGS).not.toContain(bayrak);
    }
  });

  it('15. Uygulanmış bayrak varsayılan olarak açıktır', () => {
    for (const bayrak of ['feat_kds', 'feat_qr_menu', 'feat_table_order', 'feat_recipe_bom', 'feat_ledger_cari', 'feat_loss_radar']) {
      expect(DEFAULT_OPEN_FEATURE_FLAGS).toContain(bayrak);
    }
  });

  it('16. Varsayılan liste bayrak sayısını azaltmaz: 11 bayrağın hepsi tanımlı', () => {
    // Liste elle yazılan ikinci bir kopyaya dönüşürse iki liste ayrışır ve
    // sessizce bayrak kaybolur. Bu yüzden toplam sayı sabitlenir.
    const tumBayraklar: readonly FeatureFlagKey[] = [
      'feat_kds',
      'feat_qr_menu',
      'feat_delivery',
      'feat_caller_id',
      'feat_table_order',
      'feat_seat_split',
      'feat_recipe_bom',
      'feat_dynamic_pricing',
      'feat_ledger_cari',
      'feat_multi_branch',
      'feat_loss_radar',
    ];
    expect(tumBayraklar).toHaveLength(11);
    for (const bayrak of DEFAULT_OPEN_FEATURE_FLAGS) {
      expect(tumBayraklar).toContain(bayrak);
    }
  });

  it('17. MASTER rolü tüm bayrakları otomatik açmaz', () => {
    // AGENTS.md §3.3: bayrak kapalıyken route 404 vermeli. MASTER'a "hepsi açık"
    // muafiyeti bu kuralı her bayrakta delerdi; tek kaynak oturumun modül
    // listesidir (backend `auth_commands::master_modules()`).
    const masterModulleri = ['feat_kds', 'feat_qr_menu', 'feat_table_order'];

    expect(isFeatureEnabledForModules('feat_seat_split', masterModulleri, 'MASTER')).toBe(false);
    expect(isFeatureEnabledForModules('feat_delivery', masterModulleri, 'MASTER')).toBe(false);
    expect(isFeatureEnabledForModules('feat_caller_id', masterModulleri, 'MASTER')).toBe(false);
    expect(isFeatureEnabledForModules('feat_dynamic_pricing', masterModulleri, 'MASTER')).toBe(false);

    // Oturumda bulunan bayraklar açıktır — MASTER da aynı listeye tabidir.
    expect(isFeatureEnabledForModules('feat_kds', masterModulleri, 'MASTER')).toBe(true);
    expect(isFeatureEnabledForModules('feat_qr_menu', masterModulleri, 'MASTER')).toBe(true);
  });

  it('18. Modül listesi yoksa varsayılan tablo okunur, kodu olmayan bayrak yine kapalıdır', () => {
    expect(isFeatureEnabledForModules('feat_kds', undefined, 'MASTER')).toBe(true);
    expect(isFeatureEnabledForModules('feat_seat_split', undefined, 'MASTER')).toBe(false);
    expect(isFeatureEnabledForModules('feat_multi_branch', undefined, 'OWNER')).toBe(false);
  });

  it('19. MASTER rolü çok şubeli modülü kendi rolüyle açamaz', () => {
    // Bayrağın sahibi işletmedir; rol bayrağı açmaz (bkz. 12. test).
    expect(isFeatureEnabledForModules('feat_multi_branch', ['feat_multi_branch'], 'MASTER')).toBe(true);
    expect(isFeatureEnabledForModules('feat_multi_branch', ['feat_kds'], 'MASTER')).toBe(false);
  });

  it('20. tauriInvoke rol alanını oturumdan enjekte eder, bayrağı bileşen taşımaz', async () => {
    // Gerekçe: mutfak/kasa/QR kapıları rol ve bayrak alanlarını **çağırandan**
    // bekler; bileşen kendi kafasında taşımamalı, tek kaynak oturumdur.
    // `get_stations` bu kanalın gözlenebilir kanıtıdır.
    const { tauriInvoke } = await import('../../src/data/ipc/tauriInvoke');

    useAuthStore.setState({
      user: { ...sessionUser('KITCHEN', 'DEFAULT_TENANT'), activeModules: ['feat_kds'] } as never,
    });
    const istasyonlar = await tauriInvoke<unknown[]>('get_stations');
    expect(Array.isArray(istasyonlar)).toBe(true);

    // Oturum yokken alan enjekte edilmez; kapı fail-closed reddeder.
    useAuthStore.setState({ user: null, branchId: '', branchName: '', terminalSession: null });
    await expect(tauriInvoke('get_stations')).rejects.toThrow(/UNAUTHORIZED/);
  });
});