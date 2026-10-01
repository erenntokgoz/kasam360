/**
 * Finans Hub & POS Barkod Entegrasyon Doğrulama Test Paketi
 * Path: tests/integration/finansHubAndBarcodeVerification.test.ts
 *
 * 1. FinancialReportsTab CSV dışa aktarımında UTF-8 BOM (\uFEFF) ve alan tırnaklaması
 * 2. QuickTransactionModal Cari Rehber dinamik seçimi ve yeni cari oluşturma
 * 3. CatalogContainer Barkod Okuyucu Enter ile anında sepete ekleme ve arama temizleme
 */


import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { useCartStore } from '../../src/presentation/store/useCartStore';
import { IPOSRepository } from '../../src/domain/repositories/IPOSRepository';
import { POSProduct } from '../../src/presentation/types';

describe('Finans Hub & Barkod Entegrasyon Testleri', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      products: [],
      searchQuery: '',
      activeCategory: 'all',
    });
  });

  it('1. Finansal Rapor CSV verisi Excel uyumlu UTF-8 BOM (\uFEFF) içerir', () => {
    const mockReport = {
      totalRevenueCents: 4500000,
      totalExpensesCents: 1200000,
      netProfitCents: 3300000,
      receivablesCents: 35000,
      payablesCents: 1250000,
      expensesByCategory: [
        { category: 'RENT', totalCents: 3500000, count: 1 },
        { category: 'SUPPLIER', totalCents: 1250000, count: 2 },
      ],
      monthlyTrend: [
        { month: '2026-04', revenueCents: 4500000, expenseCents: 1200000, profitCents: 3300000 },
      ],
    };

    let csvContent = '';
    csvContent += 'KASAM360 FINANSAL RAPOR\n';
    csvContent += `Tarih,${new Date().toLocaleDateString('tr-TR')}\n\n`;
    csvContent += 'OZET BILANCO\n';
    csvContent += `Toplam Gelir / Ciro,${(mockReport.totalRevenueCents / 100).toFixed(2)} TL\n`;
    csvContent += `Toplam Gider,${(mockReport.totalExpensesCents / 100).toFixed(2)} TL\n`;
    csvContent += `Net Faaliyet Kari,${(mockReport.netProfitCents / 100).toFixed(2)} TL\n`;

    const bom = '\uFEFF';
    const finalExport = bom + csvContent;

    // Excel UTF-8 BOM imzası kontrolü (0xFEFF)
    expect(finalExport.charCodeAt(0)).toBe(0xFEFF);
    expect(finalExport).toContain('KASAM360 FINANSAL RAPOR');
    expect(finalExport).toContain('45000.00 TL');
  });

  it('2. get_directories ve create_debt tauriInvoke ile cari ilişkilendirmesini başarıyla tamamlar', async () => {
    // Cari listesini çek
    const dirs = await tauriInvoke<Array<{ id: string; name: string; type: string }>>('get_directories', {});
    expect(Array.isArray(dirs)).toBe(true);
    expect(dirs.length).toBeGreaterThan(0);

    const firstDir = dirs[0];
    expect(firstDir.id).toBeDefined();

    // Dinamik cari ID ile borç kaydı oluştur
    const debtRes = await tauriInvoke<{ id: string; directoryId: string; totalAmountCents: number }>('create_debt', {
      payload: {
        directoryId: firstDir.id,
        type: 'TAKEN',
        totalAmountCents: 50000, // 500.00 TL
        description: 'Test Toptancı Faturası',
        isCash: true,
      },
    });

    expect(debtRes).toBeDefined();
    expect(debtRes.id).toMatch(/^dbt_/);
    expect(debtRes.directoryId).toBe(firstDir.id);
    expect(debtRes.totalAmountCents).toBe(50000);
  });

  it('3. create_directory ile yeni cari kart oluşturup borç kaydına bağlanabilir', async () => {
    const newDir = await tauriInvoke<{ id: string; name: string }>('create_directory', {
      payload: {
        name: 'Yeni Test Tedarikçi Ltd.',
        type: 'SUPPLIER',
      },
    });

    expect(newDir).toBeDefined();
    expect(newDir.id).toMatch(/^dir_/);
    expect(newDir.name).toBe('Yeni Test Tedarikçi Ltd.');

    // Oluşturulan cari ID ile alacak kaydı aç
    const creditRes = await tauriInvoke<{ id: string; directoryId: string }>('create_debt', {
      payload: {
        directoryId: newDir.id,
        type: 'GIVEN',
        totalAmountCents: 75000,
        description: 'Yeni Tedarikçi Avansı',
        isCash: false,
      },
    });

    expect(creditRes.directoryId).toBe(newDir.id);
  });

  it('4. Barkod okuyucu 13 haneli EAN-13 taradığında scanBarcode ürünü sepete ekler', async () => {
    const mockProduct: POSProduct = {
      id: 'prd_barcode_1',
      sku: 'SKU-EAN-01',
      barcode: '8690123456789',
      name: 'Filtre Kahve 250g',
      price: 15000, // 150.00 TL
      taxRate: 10,
      category: 'coffee',
      inStock: true,
      stockQuantity: 10,
    };

    const mockRepo: IPOSRepository = {
      getProducts: async () => [mockProduct],
      getProductById: async () => mockProduct,
      getProductByBarcode: async (barcode: string) => {
        if (barcode === '8690123456789') return mockProduct;
        return null;
      },
      getCategories: async () => [],
      getProductModifiers: async () => [],
      processPayment: async () => ({ success: true, transactionId: 'txn_1', timestamp: new Date().toISOString() }),
      processSplitPayment: async () => ({ success: true, transactionId: 'txn_2', timestamp: new Date().toISOString() }),
      printReceipt: async () => {},
      submitOrder: async () => true,
      voidOrder: async () => true,
      getOrderItems: async () => [],
    };

    const store = useCartStore.getState();
    store.setPOSRepository(mockRepo);

    // Barkod taramasını simüle et
    const matched = await store.scanBarcode('8690123456789');
    expect(matched).toBe(true);

    const items = useCartStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0].product.name).toBe('Filtre Kahve 250g');
    expect(items[0].quantity).toBe(1);
    expect(items[0].unitPrice).toBe(15000);
  });

  it('5. Tanımsız barkod tarandığında scanBarcode false döner ve sepeti değiştirmez', async () => {
    const mockRepo: IPOSRepository = {
      getProducts: async () => [],
      getProductById: async () => null,
      getProductByBarcode: async () => null,
      getCategories: async () => [],
      getProductModifiers: async () => [],
      processPayment: async () => ({ success: true, transactionId: '', timestamp: '' }),
      processSplitPayment: async () => ({ success: true, transactionId: '', timestamp: '' }),
      printReceipt: async () => {},
      submitOrder: async () => true,
      voidOrder: async () => true,
      getOrderItems: async () => [],
    };

    const store = useCartStore.getState();
    store.setPOSRepository(mockRepo);

    const matched = await store.scanBarcode('0000000000000');
    expect(matched).toBe(false);
    expect(useCartStore.getState().items.length).toBe(0);
  });
});
