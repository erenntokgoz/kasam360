import { test, expect, type Page } from '@playwright/test';

/**
 * Faz 7 — Hesap Defteri finansal hareketleri ve fiş görüntüleyici.
 *
 * Doğrulanan kurallar:
 *  1. Ayrı bir "Fişler" ekranı artık yok; gezinme çubuğunda görünmez.
 *  2. Hesap Defteri içinde "Finansal Hareketler ve Fişler" paneli vardır.
 *  3. Tahsilat satırında "Fişi Görüntüle" çalışır; kasa hareketinde "Fiş yok" yazar.
 */
/**
 * Fiş ve kasa hareketi kayıtlarını mock deposuna yazar.
 *
 * Neden seed: tarayıcı mock'u localStorage'da `kasam360_mock_` önekiyle tutar; test, panelde **her iki
 * durumu** da (tahsilat satırı ve "Fiş yok" satırı) deterministik görmelidir.
 */
async function seedMovements(page: Page): Promise<void> {
  const tenant = 'DEFAULT_TENANT';
  const now = new Date().toISOString();
  await page.addInitScript(
    ({ tenant: seedTenant, timestamp }) => {
      localStorage.setItem(
        'kasam360_mock_receipts',
        JSON.stringify([
          {
            id: 'txn_ledger_demo',
            tenant_id: seedTenant,
            table_id: 'Masa 3',
            total_cents: 18500,
            created_at: timestamp,
            cashier_id: 'usr_cashier',
            transaction_id: 'txn_ledger_demo',
            order_id: 'ord_ledger_demo',
            fiscal_receipt_no: 'FISC-txn_l',
            method: 'CASH',
            amount_tendered_cents: 20000,
            change_cents: 1500,
            notes: null,
            items: [
              {
                id: 'ri_1',
                product_id: 'prd_1',
                product_name: 'Türk Kahvesi',
                quantity: 2,
                unit_price_cents: 8500,
                tax_rate: 10,
                subtotal_cents: 17000,
                tax_amount_cents: 1700,
                total_cents: 18700,
              },
            ],
          },
        ]),
      );
      localStorage.setItem(
        'kasam360_mock_cash_movements',
        JSON.stringify([
          {
            id: 'cmin_demo',
            tenant_id: seedTenant,
            shift_id: 'shift_demo',
            movement_type: 'IN',
            amount_cents: 10000,
            reason: 'Bozuk para',
            actor_id: 'usr_cashier',
            created_at: timestamp,
          },
        ]),
      );
    },
    { tenant, timestamp: now },
  );
}

async function loginAs(page: Page, roleLabel: string): Promise<void> {
  await page.goto('/');
  // Giriş ekranı e-posta/şifre ister; "Test Rolleri" menüsü formu doldurur.
  await page.getByRole('button', { name: 'Test Rolleri' }).click();
  await page.getByRole('button', { name: new RegExp(roleLabel) }).click();
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
  await expect(page.locator('nav')).toBeVisible({ timeout: 20000 });
}

test.describe('Faz 7 — Hesap Defteri ve Fiş Görüntüleyici', () => {
  test('ayrı Fişler ekranı kaldırıldı', async ({ page }) => {
    await loginAs(page, 'Patron');
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
    // Fiş artık ayrı bir gezinme öğesi değil.
    await expect(nav.getByText('Fişler', { exact: true })).toHaveCount(0);
  });

  test('finansal hareket paneli fiş bağlantısını ve "Fiş yok" durumunu gösterir', async ({ page }) => {
    await seedMovements(page);
    await loginAs(page, 'Patron');

    await page.locator('nav').getByText('Hesap Defteri').first().click();
    await expect(page.getByText('Finansal Hareketler ve Fişler')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: '../docs/evidence/faz7-ledger-movements.png' });

    // Tahsilat satırı fişe bağlanır; kasa hareketi fişsizdir ve "Fiş yok" der.
    const rows = page.getByRole('button', { name: 'Fişi Görüntüle' });
    const missing = page.getByText('Fiş yok', { exact: true });
    await expect(rows).toHaveCount(1);
    await expect(missing).toHaveCount(1);

    await rows.first().click();
    const dialog = page.getByRole('dialog', { name: 'Fiş detayı' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fiş Detayı')).toBeVisible();
    await expect(dialog.getByText('185,00 ₺').first()).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/faz7-receipt-viewer.png' });

    // Termal önizleme de kayıttan türer: kalem satırı görünür.
    await dialog.getByRole('button', { name: '80mm Termal Önizleme' }).click();
    await expect(dialog.getByText('FISC-txn_l').first()).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/faz7-receipt-thermal.png' });

    await dialog.getByRole('button', { name: 'Fiş penceresini kapat' }).click();
    await expect(dialog).toHaveCount(0);
  });
});