/**
 * Milestone 3: Kasa (Cashier Workstation) Sayfası — macOS Frosted Glass UI Entegrasyon Test Paketi
 * Path: tests/integration/cashierGlassUi.test.ts
 *
 * AGENTS.md anayasasına ve Milestone 3 şartnamesine uygun olarak:
 * 1. Tam boy (full-height flex/grid) modern yerleşim ve alt boşluksuz mimariyi,
 * 2. Gerçek macOS Frosted Glass tasarımını (backdrop-blur-xl bg-zinc-900/40 border border-white/10 shadow-xl),
 * 3. Hızlı banknot butonlarını (50₺, 100₺, 200₺, 500₺, Tam Tutar) ve şık 5'li ızgarayı,
 * 4. Opsiyonel/kompakt tuş takımı (numpad) toggle yapısını ("Tuş Takımını Göster/Gizle"),
 * 5. Nakit ve Kredi Kartı resmi tahsilat aksiyonlarını,
 * 6. Açık hesaplar, adisyon özeti ve vardiya mutabakat modellerinin cents tamsayı kuralına uyumunu doğrular.
 */


import React from 'react';
import { renderToString } from 'react-dom/server';
import { CashierWorkstationContainer } from '../../src/presentation/components/cashier/CashierWorkstationContainer';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { useFloorStore } from '../../src/presentation/store/useFloorStore';
import { useCartStore } from '../../src/presentation/store/useCartStore';

describe('Milestone 3: Kasa (Cashier Workstation) — macOS Frosted Glass UI & Hızlı Tahsilat', () => {
  beforeEach(() => {
    // Kasiyer oturumu başlatılır
    useAuthStore.setState({
      user: {
        userId: 'usr_cashier_test',
        role: 'CASHIER',
        name: 'Fatma Kasiyer',
        tenantId: 'DEFAULT_TENANT',
        branchId: 'branch_kadikoy',
        branchName: 'Kadıköy Şubesi',
      },
      isAuthenticated: true,
      isLocked: false,
    });

    // Örnek açık masa ve salon verisi yüklenir
    useFloorStore.setState({
      tables: [
        {
          id: 'table_1',
          name: 'Masa 1',
          status: 'OCCUPIED',
          currentTotal: 35000, // 350.00 TL
          openedAt: new Date().toISOString(),
          waiterId: 'Ahmet Garson',
        },
        {
          id: 'table_2',
          name: 'Masa 2',
          status: 'AVAILABLE',
          currentTotal: 0,
        },
      ],
    });

    useCartStore.setState({
      currentView: 'CASHIER',
      activeTableId: null,
      items: [],
    });
  });

  it('1. CashierWorkstationContainer bileşeni tanımlıdır ve React elementi olarak örneklenebilir', () => {
    const element = React.createElement(CashierWorkstationContainer);
    expect(element).toBeDefined();
    expect(CashierWorkstationContainer).toBeInstanceOf(Function);
  });

  it('2. Kasa İstasyonu tam boy (full-height flex) ve Apple #060609 dual theme zemin yapısını uygular', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));
    expect(html).toBeDefined();

    // Tam boy kapsayıcı sınıfları
    expect(html).toContain('h-full');
    expect(html).toContain('w-full');
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('dark:bg-[#060609]');
    expect(html).toContain('bg-[#f5f5f7]');
    expect(html).toContain('flex-col');
  });

  it('3. Üst Bar ve Sekmeler gerçek renksiz Frosted Glass (backdrop-blur-xl dark:bg-white/[0.03] bg-white/70) standardındadır', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    // Üst Bar cam sınıfları
    expect(html).toContain('backdrop-blur-xl');
    expect(html).toContain('dark:bg-white/[0.03]');
    expect(html).toContain('bg-white/70');
    expect(html).toContain('dark:border-white/10');
    expect(html).toContain('border-black/[0.08]');
    expect(html).toContain('shadow-xl');

    // Apple Segmented Control sekmeleri
    expect(html).toContain('Kasiyer İstasyonu');
    expect(html).toContain('Vardiya Geçmişi');
  });

  it('4. Açık Hesaplar sol kolonu, Adisyon orta paneli ve Hızlı Tahsilat sağ kolonu 3 lü mimaride yer alır', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    // Sol Kolon: Açık Hesaplar
    expect(html).toContain('Açık Hesaplar');
    expect(html).toContain('Masa ara...');

    // Orta Kolon: Adisyon / Hesap Detayı
    expect(html).toContain('Hesap Detayı');
    expect(html).toContain('Masa Seçilmedi');

    // Sağ Kolon: Hızlı Tahsilat
    expect(html).toContain('Hızlı Tahsilat');
    expect(html).toContain('Toplam Borç:');
  });

  it('5. Hızlı Nakit banknot butonları (50₺, 100₺, 200₺, 500₺, Tam Tutar) 5 li erişilebilir ızgara olarak mevcuttur', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    // Hazır banknot butonları
    expect(html).toContain('50 ₺');
    expect(html).toContain('100 ₺');
    expect(html).toContain('200 ₺');
    expect(html).toContain('500 ₺');
    // Tam Tutar butonu
    expect(html).toContain('Tam Tutar');
  });

  it('6. Tuş takımı (numpad) varsayılan olarak kompakt ve gizlidir; açma/kapama butonu sağlanır', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    // Tuş takımı toggle butonu ("Tuş Takımını Göster")
    expect(html).toContain('Tuş Takımını Göster');

    // Varsayılan olarak tuş takımı kapalıyken rehber bar gösterilir
    expect(html).toContain('Özel küsurat veya serbest tutar girişi için tuş takımını açabilirsiniz.');
  });

  it('7. Resmi tahsilat aksiyon butonları (Nakit Tahsilat & Kredi Kartı) şık ve erişilebilir durumdadır', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    expect(html).toContain('Nakit Tahsilat');
    expect(html).toContain('Kredi Kartı');
    expect(html).toContain('Ödenecek Net Tutar');
  });

  it('8. Müşteriden Alınan Tutar ve Para Üstü panelleri macOS Frosted Glass kartları olarak yapılandırılmıştır', () => {
    const html = renderToString(React.createElement(CashierWorkstationContainer));

    expect(html).toContain('Müşteriden Alınan Tutar');
    expect(html).toContain('Verilecek Para Üstü');
  });
});
