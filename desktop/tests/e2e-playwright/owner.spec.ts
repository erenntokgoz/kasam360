import { test, expect } from '@playwright/test';

test.describe('OWNER Role Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Giriş yüzeyi rol listesini "Test Rolleri" düğmesinin arkasında tutar;
    // seçilen hesap bilgileri forma doldurulur, giriş "Giriş Yap" ile tamamlanır.
    await page.getByRole('button', { name: 'Test Rolleri' }).click();
    await page.getByRole('button', { name: /Patron/ }).first().click();
    await page.getByRole('button', { name: 'Giriş Yap' }).click();
    // Wait for Owner Dashboard
    await expect(page.getByRole('button', { name: 'Genel Bakış' })).toBeVisible();
  });

  test('OWNER: dashboard and KPI metrics', async ({ page }) => {
    await expect(page.getByText('GÜNÜN CIROSU')).toBeVisible();
    await expect(page.getByText('TOPLAM SIPARIŞ')).toBeVisible();
  });

  // Faz 5: "Satışlar" ve "Operasyonel Raporlar" ayrı sekmelerdi ve ikisi de
  // tenant'sız komutlardan besleniyordu. Tek "Raporlar" merkezi kaldı; test artık
  // o yüzeyi ve tarih filtresini doğruluyor.
  test('OWNER: birleşik rapor merkezi', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Satışlar', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Raporlar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Raporlar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Son 7 gün' })).toBeVisible();
    // Rapor bölümleri tek merkez altında sekmelenir. Kapsam rapor merkezinin
    // kendi navigasyonuna daraltılır: uygulama genelinde "Fişler" başka bir
    // yüzeyde de bulunuyor ve genel eşleşme belirsizlik hatası verir.
    const reportTabs = page.getByRole('navigation', { name: 'Rapor bölümleri' });
    for (const label of ['Özet', 'Fişler', 'Vardiyalar', 'İptal / İade']) {
      await expect(reportTabs.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test('OWNER: rapor dışa aktarma düğmeleri görünür', async ({ page }) => {
    await page.getByRole('button', { name: 'Raporlar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CSV indir' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excel indir' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yazdır / PDF' })).toBeVisible();
  });

  test('OWNER: menu management (product, category, price)', async ({ page }) => {
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ürün Ekle' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kategori Ekle' })).toBeVisible();
  });

  test('OWNER: inventory tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Stok & Reçete' }).click();
    await expect(page.getByRole('heading', { name: 'Stok & Reçete Yönetimi' })).toBeVisible();
  });

  test('OWNER: staff tab', async ({ page }) => {
    await page.getByRole('button', { name: 'Personel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Personel & Yetki Yönetimi' })).toBeVisible();
  });

  // Faz 4: bağımsız "Modifierlar" sekmesi kaldırıldı; modifier yönetimi
  // menü yönetimine gömüldü. Test sekmeyi değil, **yeni yüzeyi** doğrular.
  test('OWNER: modifier sekmesi kaldırıldı, menü yönetimine gömüldü', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Modifierlar' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await page.getByRole('button', { name: 'Ürün Ekle' }).click();
    await expect(page.getByText('Seçenekler & Ekstralar')).toBeVisible();
    // Fiyat farkının ürün fiyatına karışmadığı yüzeyde açıklanır.
    await expect(
      page.getByText(/Seçenek fiyatı, ürünün temel fiyatına eklenmez/),
    ).toBeVisible();
  });

  // Faz 6: patron panelindeki "Şubeler" sekmesi **kaldırıldı**. Şube yazımı
  // yalnız platform yöneticisine (MASTER) açıktır; patronun tek şube yetkisi
  // üst bardaki geçiş açılır listesidir.
  test('OWNER: şube sekmesi kaldırıldı', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Şubeler', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Şubeler' })).toHaveCount(0);
  });
});