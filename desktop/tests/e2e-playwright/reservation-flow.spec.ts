import { test, expect, type Page } from '@playwright/test';

/**
 * Faz 8 — Rezervasyon düzeltmesi (Spec §11).
 *
 * Doğrulanan kurallar:
 *  1. Boş masada hızlı rezerve ikonu vardır ve rezervasyon penceresi açılır.
 *  2. Rezerve edilen masa salon planında müşteri adıyla görünür.
 *  3. **Dolu masada rezervasyon aksiyonu yoktur** (eski `Rezerve Et` butonu kaldırıldı).
 *  4. Rezerve masada "Müşteri Geldi", "Rezervasyonu Kaldır" ve "Müşteri Gelmedi" vardır.
 *  5. "Müşteri Geldi" masayı işgal etmez; kayıt GELDİ olarak görünür.
 */

async function seedReservationState(page: Page): Promise<void> {
  // Salon planı: bir boş masa, bir dolu masa (açık hesaplı), iki boş masa.
  await page.addInitScript(() => {
    localStorage.setItem(
      'kasam360_mock_tables',
      JSON.stringify([
        { id: 'tbl-e2e-1', tenant_id: 'DEFAULT_TENANT', name: 'Masa 1', status: 'AVAILABLE', currentTotal: 0 },
        { id: 'tbl-e2e-2', tenant_id: 'DEFAULT_TENANT', name: 'Masa 2', status: 'AVAILABLE', currentTotal: 0 },
        { id: 'tbl-e2e-3', tenant_id: 'DEFAULT_TENANT', name: 'Masa 3', status: 'OCCUPIED', currentTotal: 18500, openedAt: new Date().toISOString() },
        { id: 'tbl-e2e-4', tenant_id: 'DEFAULT_TENANT', name: 'Masa 4', status: 'RESERVED', currentTotal: 0 },
        { id: 'tbl-e2e-5', tenant_id: 'DEFAULT_TENANT', name: 'Masa 5', status: 'AVAILABLE', currentTotal: 0 },
        { id: 'tbl-e2e-6', tenant_id: 'DEFAULT_TENANT', name: 'Masa 6', status: 'AVAILABLE', currentTotal: 0 },
      ])
    );
    // Rezervasyon kaydı: MASA 4, 42 dakika önce yazıldı (35 dk hareketsizlik eşiğini aşar).
    localStorage.setItem(
      'kasam360_mock_reservations',
      JSON.stringify([
        {
          id: 'rsv-e2e-1',
          tenant_id: 'DEFAULT_TENANT',
          table_id: 'tbl-e2e-4',
          status: 'ACTIVE',
          customer_name: 'Ayşe Yılmaz',
          customer_phone: '0555 000 00 00',
          party_size: 4,
          reserved_at: new Date(Date.now() + 30 * 60000).toISOString(),
          created_at: new Date(Date.now() - 42 * 60000).toISOString(),
          created_by: 'usr_waiter',
          created_by_role: 'WAITER',
        },
      ])
    );
  });
}

async function loginAsWaiter(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Test Rolleri' }).click();
  await page.getByRole('button', { name: /Garson/ }).click();
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click();
  await expect(page.locator('nav')).toBeVisible({ timeout: 20000 });
  await page.locator('nav').getByText('Masalar').first().click();
  await expect(page.getByText('Salon ve Masa Planı')).toBeVisible({ timeout: 15000 });
}

test.describe('Faz 8 — Rezervasyon düzeltmesi', () => {
  test('rezerve kart müşteri adını, kişi sayısını ve bekleme süresini gösterir', async ({ page }) => {
    await seedReservationState(page);
    await loginAsWaiter(page);

    const card = page.getByRole('button', { name: /Masa 4, durum: Rezerve/ });
    await expect(card).toBeVisible();
    await expect(card.getByText('Ayşe Yılmaz • 4 kişi')).toBeVisible();
    // 42 dakika bekleyen rezervasyon 35 dk hareketsizlik uyarısına düşer.
    await expect(card.getByText('42 dk')).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/faz8-floor-reserved-card.png' });
  });

  test('boş masada hızlı rezerve ikonu açılır ve rezervasyon yazılır', async ({ page }) => {
    await seedReservationState(page);
    await loginAsWaiter(page);

    await page.getByRole('button', { name: 'Masa 1 hızlı rezerve et' }).click();
    const dialog = page.getByRole('dialog', { name: /Masa 1 — Rezervasyon/ });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Müşteri Adı *').fill('Mehmet Şahin');
    await dialog.getByLabel('Telefon').fill('0555 111 22 33');
    await dialog.getByLabel('Kişi Sayısı').fill('3');
    await page.screenshot({ path: '../docs/evidence/faz8-reserve-modal.png' });
    await dialog.getByRole('button', { name: 'Rezerve Et' }).click();

    await expect(dialog).toHaveCount(0);
    const card = page.getByRole('button', { name: /Masa 1, durum: Rezerve/ });
    await expect(card).toBeVisible();
    await expect(card.getByText('Mehmet Şahin • 3 kişi')).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/faz8-floor-after-reserve.png' });
  });

  test('dolu masada rezervasyon aksiyonu yoktur, rezerve masada vardır', async ({ page }) => {
    await seedReservationState(page);
    await loginAsWaiter(page);

    // Dolu masa: rezervasyon butonu render edilmez (Spec §11).
    await page.getByRole('button', { name: /Masa 3, durum: Dolu/ }).click();
    const occupiedDialog = page.getByRole('dialog');
    await expect(occupiedDialog).toBeVisible();
    await expect(occupiedDialog.getByText('Rezerve Et', { exact: true })).toHaveCount(0);
    await expect(occupiedDialog.getByText('Rezervasyonu Kaldır')).toHaveCount(0);
    await page.screenshot({ path: '../docs/evidence/faz8-occupied-no-reserve.png' });
    await occupiedDialog.getByRole('button', { name: 'Kapat' }).click();

    // Rezerve masa: gerçek rezervasyon aksiyonları sunulur.
    await page.getByRole('button', { name: /Masa 4, durum: Rezerve/ }).click();
    const reservedDialog = page.getByRole('dialog');
    await expect(reservedDialog.getByText('Ayşe Yılmaz')).toBeVisible();
    await expect(reservedDialog.getByRole('button', { name: 'Müşteri Geldi' })).toBeVisible();
    await expect(reservedDialog.getByRole('button', { name: 'Rezervasyonu Kaldır' })).toBeVisible();
    await expect(reservedDialog.getByRole('button', { name: 'Müşteri Gelmedi' })).toBeVisible();
    // "Geldi" işaretlenmeden adisyon açılmaz.
    await expect(reservedDialog.getByText('Sipariş Ekle')).toHaveCount(0);
    await page.screenshot({ path: '../docs/evidence/faz8-reserved-actions.png' });
  });

  test('müşteri geldi işareti kaydı değiştirir, masayı işgal etmez', async ({ page }) => {
    await seedReservationState(page);
    await loginAsWaiter(page);

    await page.getByRole('button', { name: /Masa 4, durum: Rezerve/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Müşteri Geldi' }).click();

    const card = page.getByRole('button', { name: /Masa 4, durum: Rezerve/ });
    await expect(card.getByText('GELDİ')).toBeVisible();
    await expect(card.getByText('Adisyon bekliyor')).toBeVisible();
    // Adisyon açılabilir hale gelir.
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Sipariş Ekle')).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/faz8-arrived.png' });
  });
});
