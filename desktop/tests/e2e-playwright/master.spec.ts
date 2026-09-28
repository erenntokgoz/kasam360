import { test, expect } from '@playwright/test';

test.describe('MASTER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const pinModeBtn = page.getByRole('button', { name: 'PIN ile Giriş Yap' });
    if (await pinModeBtn.isVisible()) {
      await pinModeBtn.click();
    }
    // Quick login as MASTER (PIN 1111)
    const masterBtn = page.getByRole('button', { name: '1111 Master' });
    await expect(masterBtn).toBeVisible();
    await masterBtn.click();
    // Wait for Platform Admin container
    await expect(page.getByText('PLATFORM ADMIN')).toBeVisible();
  });

  test('MASTER: login and platform container display', async ({ page }) => {
    await expect(page.getByText('Platform Özeti & Sistem KPI Metrikleri')).toBeVisible();
    await expect(page.getByText('SÜPER ADMIN (MASTER)')).toBeVisible();
  });

  test('MASTER: tenant creation, tenant details, suspend/activate', async ({ page }) => {
    // Navigate to Tenants tab
    await page.getByRole('button', { name: 'Müşteri (Tenant) Yönetimi' }).click();
    await expect(page.getByText('Müşteri (Tenant) Yönetimi').first()).toBeVisible();

    // Open tenant creation form
    const createBtn = page.getByRole('button', { name: '+ Eksiksiz Müşteri Kaydı' });
    await createBtn.click();

    // Fill form
    const tenantName = `E2E Tenant ${Date.now()}`;
    await page.getByPlaceholder('Örn: Bebek Lounge & Bistro').fill(tenantName);
    await page.getByPlaceholder('Örn: Ahmet Yılmaz').fill('Test Manager');
    await page.getByPlaceholder('info@bebeklounge.com').fill('e2e@test.com');
    await page.getByPlaceholder('0532 XXX XX XX').fill('05321112233');

    // Submit form
    await page.getByRole('button', { name: 'Müşteriyi & İşletmeyi Oluştur' }).click();

    // Filter table by search query
    await page.getByPlaceholder('Müşteri adı, benzersiz ID veya paket ile anında filtrele...').fill(tenantName);
    const tenantRow = page.getByText(tenantName);
    await expect(tenantRow).toBeVisible();

    // View Tenant details
    await tenantRow.click();
    await expect(page.getByRole('heading', { name: tenantName })).toBeVisible();

    // Suspend / Activate inside modal
    const suspendBtn = page.getByRole('button', { name: 'Müşteriyi Askıya Al (Beklet)' });
    if (await suspendBtn.isVisible()) {
      await suspendBtn.click();
      await expect(page.getByText('İşletme başarıyla askıya alındı')).toBeVisible();

      const activateBtn = page.getByRole('button', { name: 'Müşteriyi Aktifleştir' });
      await expect(activateBtn).toBeVisible();
      await activateBtn.click();
      await expect(page.getByText('İşletme başarıyla aktifleştirildi')).toBeVisible();
    }

    // Close modal
    await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  });

  test('MASTER: subscription / plan navigation & options', async ({ page }) => {
    await page.getByRole('button', { name: 'Abonelikler & Planlar' }).click();
    await expect(page.getByText('Lisans, Paket & Abonelik Yönetimi').first()).toBeVisible();
  });

  test('MASTER: device / users panels navigation', async ({ page }) => {
    await page.getByRole('button', { name: 'Genel Kullanıcılar & Roller' }).click();
    await expect(page.getByText('Genel Kullanıcılar & Rol Yönetimi').first()).toBeVisible();

    await page.getByRole('button', { name: 'Cihazlar & Sağlık' }).click();
    await expect(page.getByText('Terminal Cihazları & Sistem Sağlığı').first()).toBeVisible();
  });
});
