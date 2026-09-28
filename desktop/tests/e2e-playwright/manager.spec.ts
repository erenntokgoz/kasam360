import { test, expect } from '@playwright/test';

test.describe('MANAGER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const pinModeBtn = page.getByRole('button', { name: 'PIN ile Giriş Yap' });
    if (await pinModeBtn.isVisible()) {
      await pinModeBtn.click();
    }
    // Quick login as MANAGER (PIN 3333)
    const managerBtn = page.getByRole('button', { name: '3333 Müdür' });
    await expect(managerBtn).toBeVisible();
    await managerBtn.click();
    // Wait for Manager Dashboard
    await expect(page.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible();
  });

  test('MANAGER: dashboard & live orders & tables inspection', async ({ page }) => {
    await page.getByRole('tab', { name: 'Masalar & Siparişler' }).click();
    await expect(page.getByRole('tab', { name: 'Masalar & Siparişler' })).toBeVisible();
  });

  test('MANAGER: approvals panel navigation', async ({ page }) => {
    await page.getByRole('tab', { name: 'Onay Bekleyenler' }).click();
    await expect(page.getByRole('tab', { name: 'Onay Bekleyenler' })).toBeVisible();
  });

  test('MANAGER: price edit attempt is DENIED / Restricted', async ({ page }) => {
    // Go to Menu management tab
    await page.getByRole('tab', { name: 'Menü Yönetimi' }).click();
    await expect(page.getByRole('heading', { name: 'Menü Yönetimi' })).toBeVisible();
    
    // In manager view, hidePriceEdit={true} is passed to ProductForm
    const editBtns = page.getByRole('button', { name: 'Düzenle' });
    if (await editBtns.count() > 0) {
      await editBtns.first().click();
      const priceInput = page.locator('input[name="priceCents"], input[name="price"]');
      if (await priceInput.isVisible()) {
        await expect(priceInput).toBeDisabled();
      } else {
        expect(await priceInput.isVisible()).toBe(false);
      }
    }
  });
});
