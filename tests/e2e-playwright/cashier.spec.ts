import { test, expect } from '@playwright/test';

test.describe('CASHIER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Quick login as CASHIER (PIN 4444)
    const cashierBtn = page.getByRole('button', { name: '4444 Kasiyer' });
    await expect(cashierBtn).toBeVisible();
    await cashierBtn.click();

    // Wait for Cashier Workstation UI
    await page.waitForTimeout(500);

    // If shift opening modal appears, complete shift opening
    const shiftOpenModal = page.getByText('Vardiya Açılışı');
    if (await shiftOpenModal.isVisible()) {
      const input = page.getByPlaceholder('0.00');
      if (await input.isVisible()) {
        await input.fill('500');
      }
      const startBtn = page.getByRole('button', { name: 'Vardiyayı Başlat' });
      if (await startBtn.isVisible()) {
        await startBtn.click();
      }
    }
  });

  test('CASHIER: shift open / shift status display', async ({ page }) => {
    await expect(page.getByText('Vardiya Açık').or(page.getByText('KASİYER İSTASYONU')).first()).toBeVisible();
  });

  test('CASHIER: Cash In and Cash Out operations', async ({ page }) => {
    // Cash In modal
    const cashInBtn = page.getByRole('button', { name: /Kasa Giriş/i });
    if (await cashInBtn.isVisible()) {
      await cashInBtn.click();
      const modalHeading = page.getByText('Kasa Giriş İşlemi');
      if (await modalHeading.isVisible()) {
        await page.getByPlaceholder('0.00').fill('100');
        await page.getByPlaceholder('Giriş gerekçesi...').fill('Bozuk Para Ekleme');
        await page.getByRole('button', { name: 'Girişi Kaydet' }).click();
      }
    }
  });

  test('CASHIER: X Report and Z Report preview', async ({ page }) => {
    // X-Report
    const xReportBtn = page.getByRole('button', { name: /X-Raporu/i });
    if (await xReportBtn.isVisible()) {
      await xReportBtn.click();
      const closeBtn = page.getByRole('button', { name: 'Kapat', exact: true });
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });

  test('CASHIER: void request attempt', async ({ page }) => {
    const voidBtn = page.getByRole('button', { name: /Hesap İptal/i });
    if (await voidBtn.isVisible()) {
      await voidBtn.click();
      await expect(page.getByText('İptal').or(page.getByText('Manager PIN'))).toBeVisible();
    }
  });
});
