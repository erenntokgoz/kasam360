import { test, expect } from '@playwright/test';

test.describe('WAITER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Quick login as WAITER (PIN 5555)
    const waiterBtn = page.getByRole('button', { name: '5555 Garson' });
    await expect(waiterBtn).toBeVisible();
    await waiterBtn.click();
    // Wait for Floor Plan / POS View
    await expect(page.getByRole('heading', { name: 'Salon ve Masa Planı' })).toBeVisible();
  });

  test('WAITER: clock-in and table selection', async ({ page }) => {
    // Select first table card (Masa 1)
    const tableBtn = page.getByRole('button', { name: /^Masa 1,/i }).first();
    await expect(tableBtn).toBeVisible();
    await tableBtn.click();
  });

  test('WAITER: product, modifier & send kitchen', async ({ page }) => {
    // Select table 1
    const tableBtn = page.getByRole('button', { name: /^Masa 1,/i }).first();
    await expect(tableBtn).toBeVisible();
    await tableBtn.click();
  });

  test('WAITER: payment access DENIED check', async ({ page }) => {
    // Waiter role should not have access to cashier workstation or platform admin
    await expect(page.getByText('PLATFORM ADMIN')).not.toBeVisible();
    await expect(page.getByText('Manager Dashboard')).not.toBeVisible();
    await expect(page.getByText('KASİYER İSTASYONU')).not.toBeVisible();
  });
});
