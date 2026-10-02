import { test, expect } from '@playwright/test';

/**
 * Faz 6 — Şube yönetimi yetki kilidi (gerçek Chromium).
 *
 * Kanıt zinciri:
 * 1. MASTER platform konsolunda şube yazımını görür; `feat_multi_branch` kapalı
 *    işletmede yüzey **404** döner.
 * 2. MASTER açık işletmede şube ekleyip arşivleyebilir; arşivli şube listeden
 *    düşer (silme değil, arşivleme).
 * 3. Patron panelinde "Şubeler" sekmesi **yoktur**.
 */

/**
 * Tohum verisi **sayfa betikleri çalışmadan önce** ve **tamamen fonksiyon
 * gövdesi içinde** yazılmalı: mock veri modülü `localStorage`'ı import anında
 * bir kez okur, ayrıca Playwright fonksiyonu serileştirir — dışarıdaki
 * değişkenlere erişemez.
 */
const seedPlatform = (multiBranch: boolean) => {
  window.localStorage.setItem(
    'kasam360_mock_tenants',
    JSON.stringify([
      {
        id: 'tnt_e2e_faz6',
        name: 'Faz6 E2E İşletmesi',
        status: 'ACTIVE',
        modules: multiBranch
          ? ['core', 'feat_kds', 'feat_multi_branch']
          : ['core', 'feat_kds'],
        created_at: '2026-01-01T00:00:00Z',
      },
    ]),
  );
  window.localStorage.setItem(
    'kasam360_mock_branches',
    JSON.stringify([
      {
        id: 'br_e2e_merkez',
        tenant_id: 'tnt_e2e_faz6',
        name: 'Merkez Şube',
        address: 'Test Caddesi No: 1',
        status: 'ACTIVE',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]),
  );
};

const boot = async (page: import('@playwright/test').Page, multiBranch: boolean) => {
  await page.addInitScript(seedPlatform, multiBranch);
  await page.goto('/');
};

test.describe('Faz 6 — Şube yönetimi', () => {
  // Giriş yüzeyi rol listesini "Test Rolleri" düğmesinin arkasında tutar
  // (bkz. owner.spec.ts); seçilen hesap forma doldurulur.
  const loginAsMaster = async (page: import('@playwright/test').Page) => {
    await page.getByRole('button', { name: 'Test Rolleri' }).click();
    await page.getByRole('button', { name: /Master/ }).first().click();
    await page.getByRole('button', { name: 'Giriş Yap' }).click();
    await expect(page.getByText('PLATFORM ADMIN')).toBeVisible();
  };

  const loginAsOwner = async (page: import('@playwright/test').Page) => {
    await page.getByRole('button', { name: 'Test Rolleri' }).click();
    await page.getByRole('button', { name: /Patron/ }).first().click();
    await page.getByRole('button', { name: 'Giriş Yap' }).click();
    await expect(page.getByRole('button', { name: 'Genel Bakış' })).toBeVisible();
  };

  test('MASTER: kapalı işletmede şube yüzeyi 404 döner', async ({ page }) => {
    await boot(page, false);
    await loginAsMaster(page);

    await page.getByRole('button', { name: 'Şube Yönetimi' }).click();

    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Çok Şubeli İşletme bu işletmede etkin değil')).toBeVisible();
    await expect(page.getByText('Faz6 E2E İşletmesi')).toBeVisible();

    await page.screenshot({ path: '../docs/evidence/faz6-sube-404-kapali.png' });
  });

  test('MASTER: açık işletmede şube ekler ve arşivler', async ({ page }) => {
    await boot(page, true);
    await loginAsMaster(page);

    await page.getByRole('button', { name: 'Şube Yönetimi' }).click();
    await expect(page.getByRole('heading', { name: 'Şube Yönetimi' })).toBeVisible();
    await expect(page.getByText('Merkez Şube').first()).toBeVisible();

    // Yeni şube ekle
    await page.getByRole('button', { name: 'Şube Ekle' }).click();
    const branchName = `E2E Şube ${Date.now()}`;
    await page.getByLabel('Şube Adı').fill(branchName);
    await page.getByLabel('Adres').fill('E2E Caddesi No: 7');
    await page.getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByText(branchName).first()).toBeVisible();

    // Arşivle: silme değil. Kart kaybolmaz, "Arşiv" rozetine döner; geçmiş
    // sipariş/vardiya kayıtları bu satıra bağlıdır (AGENTS.md §2).
    const card = page.locator('article').filter({ hasText: branchName }).first();
    await card.getByRole('button', { name: 'Arşivle' }).click();
    await page.getByRole('button', { name: 'Arşivle', exact: true }).last().click();
    await expect(card.getByText('Arşiv', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Arşivle' })).toBeDisabled();

    await page.screenshot({ path: '../docs/evidence/faz6-master-sube-yonetimi.png' });
  });

  test('OWNER: patron panelinde şube sekmesi yoktur', async ({ page }) => {
    await boot(page, true);
    await loginAsOwner(page);

    await expect(page.getByRole('button', { name: 'Genel Bakış' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Şubeler' })).toHaveCount(0);

    await page.screenshot({ path: '../docs/evidence/faz6-patron-sekmesiz.png' });
  });
});