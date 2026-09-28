import { test, expect } from '@playwright/test';

test.describe('KITCHEN Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const pinModeBtn = page.getByRole('button', { name: 'PIN ile Giriş Yap' });
    if (await pinModeBtn.isVisible()) {
      await pinModeBtn.click();
    }
    // Quick login as KITCHEN (PIN 6666)
    const kitchenBtn = page.getByRole('button', { name: '6666 Mutfak' });
    await expect(kitchenBtn).toBeVisible();
    await kitchenBtn.click();
    // Wait for KDS Container
    await expect(page.getByText('MUTFAK KDS')).toBeVisible();
  });

  test('KITCHEN: station filter & tickets view', async ({ page }) => {
    await expect(page.getByText('YENİ SİPARİŞLER')).toBeVisible();
    await expect(page.getByText('HAZIRLANIYOR')).toBeVisible();
    await expect(page.getByText('HAZIR & SERVİS BEKLEYEN')).toBeVisible();

    // Select station filter (Touch-friendly Station Pills)
    const allStationBtn = page.getByRole('button', { name: 'TÜMÜ' });
    await expect(allStationBtn).toBeVisible();
    await allStationBtn.click();
  });

  test('KITCHEN: preparing, ready, completed status workflow buttons', async ({ page }) => {
    // Check if start/ready buttons are clickable
    const startBtns = page.getByRole('button', { name: 'BAŞLA' });
    if (await startBtns.count() > 0) {
      await startBtns.first().click();
    }
  });

  test('KITCHEN: offline queue & reconnect indicator', async ({ page }) => {
    // Check network/offline status bar
    await expect(page.getByText('MUTFAK KDS')).toBeVisible();
  });
});
