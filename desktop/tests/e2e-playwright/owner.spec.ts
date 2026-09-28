import { test, expect } from '@playwright/test';

test.describe('OWNER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const pinModeBtn = page.getByRole('button', { name: 'PIN ile Giriş Yap' });
    if (await pinModeBtn.isVisible()) {
      await pinModeBtn.click();
    }
    // Quick login as OWNER (PIN 2222)
    const ownerBtn = page.getByRole('button', { name: '2222 Patron' });
    await expect(ownerBtn).toBeVisible();
    await ownerBtn.click();
    // Wait for Owner Dashboard
    await expect(page.getByRole('button', { name: 'Genel Bakış' })).toBeVisible();
  });

  test('OWNER: dashboard and KPI metrics', async ({ page }) => {
    await expect(page.getByText('Günün Ciro Özeti')).toBeVisible();
    await expect(page.getByText('Toplam Sipariş')).toBeVisible();
  });

  test('OWNER: sales / report tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Satışlar' }).click();
    await expect(page.getByRole('heading', { name: 'Satış & Ciro Raporu' })).toBeVisible();
  });

  test('OWNER: menu management (product, category, price)', async ({ page }) => {
    await page.getByRole('button', { name: 'Menü Yönetimi' }).click();
    await expect(page.getByRole('heading', { name: 'Menü Yönetimi' })).toBeVisible();
  });

  test('OWNER: inventory tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Stok' }).click();
    await expect(page.getByRole('heading', { name: 'Stok & Hammadde Yönetimi' })).toBeVisible();
  });

  test('OWNER: staff tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Personel' }).click();
    await expect(page.getByRole('heading', { name: 'Personel & Kullanıcı Yönetimi' })).toBeVisible();
  });

  test('OWNER: modifiers tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Modifierlar' }).click();
    await expect(page.getByRole('heading', { name: 'Ürün Modifier & Seçenek Yönetimi' })).toBeVisible();
  });

  test('OWNER: branch settings tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Şube Ayarları' }).click();
    await expect(page.getByRole('heading', { name: 'Şube Yönetimi & Ayarları' })).toBeVisible();
  });
});
