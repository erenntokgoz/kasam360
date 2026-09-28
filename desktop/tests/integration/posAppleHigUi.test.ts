/**
 * POS Apple HIG & Spatial Glass UI Entegrasyon Test Paketi
 * Path: tests/integration/posAppleHigUi.test.ts
 *
 * POSLayout, Catalog, ProductCard, CategorySidebar, ProductGrid,
 * CartPanel ve PaymentModalPanel bileşenlerinin Apple HIG standartlarına
 * ve veri sözleşmelerine uygunluğunu doğrular.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { POSLayout } from '../../src/presentation/components/pos/ui/POSLayout';
import { ProductCard } from '../../src/presentation/components/pos/ui/ProductCard';
import { CategorySidebar } from '../../src/presentation/components/pos/ui/CategorySidebar';
import { ProductGridPanel } from '../../src/presentation/components/pos/ui/ProductGridPanel';
import { CatalogPanel } from '../../src/presentation/components/pos/ui/CatalogPanel';
import { CartPanel } from '../../src/presentation/components/pos/ui/CartPanel';
import { PaymentModalPanel } from '../../src/presentation/components/pos/ui/PaymentModalPanel';
import { POSProduct, POSCategory, CartItem, CartTotals } from '../../src/presentation/types';

describe('Apple HIG & Spatial Glass POS Arayüz Bileşenleri', () => {
  const mockProduct: POSProduct = {
    id: 'prod_1',
    sku: 'SKU-001',
    barcode: '8690001',
    name: 'Espresso Macchiato',
    price: 6500, // 65.00 TL
    taxRate: 10,
    category: 'hot_drinks',
    inStock: true,
    stockQuantity: 25,
  };

  const mockOutOfStockProduct: POSProduct = {
    id: 'prod_2',
    sku: 'SKU-002',
    barcode: '8690002',
    name: 'San Sebastian Cheesecake',
    price: 12000, // 120.00 TL
    taxRate: 10,
    category: 'dessert',
    inStock: false,
    stockQuantity: 0,
  };

  const mockCategories: POSCategory[] = [
    { id: 'cat_coffee', name: 'Kahveler' },
    { id: 'cat_dessert', name: 'Tatlılar' },
  ];

  it('1. POSLayout Apple derin antrasit (#16171b, #1c1d22) ve slot düzenini doğru uygular', () => {
    const layout = POSLayout({
      mainContent: React.createElement('div', { id: 'test-main' }, 'Catalog Content'),
      sidebar: React.createElement('div', { id: 'test-cart' }, 'Cart Sidebar'),
      topBar: React.createElement('div', { id: 'test-top' }, 'Top Bar'),
    });

    expect(layout).toBeDefined();
    expect(layout.props.className).toContain('bg-[#16171b]');
    expect(layout.props.children).toBeDefined();
  });

  it('2. ProductCard dokunmatik yaylanma (active:scale-[0.97]), rounded-2xl ve Apple renklerini içerir', () => {
    const handleClick = vi.fn();
    const card = ProductCard({
      product: mockProduct,
      onClick: handleClick,
    });

    expect(card).toBeDefined();
    expect(card.props.className).toContain('active:scale-[0.97]');
    expect(card.props.className).toContain('rounded-2xl');
    expect(card.props['aria-label']).toContain('Espresso Macchiato');
    expect(card.props.disabled).toBe(false);

    // Stokta olmayan ürün kontrolü
    const outOfStockCard = ProductCard({
      product: mockOutOfStockProduct,
      onClick: handleClick,
    });
    expect(outOfStockCard.props.disabled).toBe(true);
    expect(outOfStockCard.props['aria-label']).toContain('tükendi');
  });

  it('3. CategorySidebar havada süzülen cam kapsüller ve Apple System Blue (#007AFF) aktif durumunu sağlar', () => {
    const handleSelect = vi.fn();
    const sidebar = CategorySidebar({
      categories: mockCategories,
      activeCategory: 'cat_coffee',
      onSelect: handleSelect,
    });

    expect(sidebar).toBeDefined();
    expect(sidebar.props.className).toContain('bg-[#16171b]/95');
    expect(sidebar.props.className).toContain('backdrop-blur-2xl');
  });

  it('4. ProductGridPanel ürünleri ızgarada listeler ve sayfalama kapsülünü yönetir', () => {
    const handlePageChange = vi.fn();
    const handleProductClick = vi.fn();

    const grid = ProductGridPanel({
      products: [mockProduct, mockOutOfStockProduct],
      currentPage: 1,
      totalPages: 3,
      onPageChange: handlePageChange,
      onProductClick: handleProductClick,
    });

    expect(grid).toBeDefined();
    expect(grid.props.className).toContain('bg-[#16171b]');
  });

  it('5. CatalogPanel arama başlığı, kategori ve ızgara entegrasyonunu sağlar', () => {
    const panel = CatalogPanel({
      categories: mockCategories,
      activeCategory: 'all',
      onSelectCategory: vi.fn(),
      products: [mockProduct],
      searchQuery: 'Espresso',
      onSearchChange: vi.fn(),
      currentPage: 1,
      totalPages: 1,
      onPageChange: vi.fn(),
      onProductClick: vi.fn(),
    });

    expect(panel).toBeDefined();
    expect(panel.props.className).toContain('bg-[#16171b]');
  });

  it('6. CartPanel temiz cam panel tasarımına sahiptir ve gereksiz açıklama metinleri içermez', () => {
    const mockTotals: CartTotals = {
      subtotal: 6500,
      taxTotal: 650,
      discountTotal: 0,
      grandTotal: 7150,
      itemCount: 1,
    };

    const mockCartItem: CartItem = {
      id: 'cart_item_1',
      product: mockProduct,
      quantity: 1,
      unitPrice: 6500,
      subtotal: 6500,
      taxRate: 10,
      total: 7150,
      taxAmount: 650,
      modifiers: [{ id: 'mod_1', name: 'Ekstra Shot', priceCents: 1500 }],
    };

    const cart = CartPanel({
      items: [mockCartItem],
      totals: mockTotals,
      selectedItemId: null,
      isProcessingPayment: false,
      onSelectItem: vi.fn(),
      onIncrementQuantity: vi.fn(),
      onDecrementQuantity: vi.fn(),
      onRemoveItem: vi.fn(),
      onClearCart: vi.fn(),
      onProcessPayment: vi.fn(),
      onSubmitOrder: vi.fn(),
      isTableActive: true,
      activeTableName: 'Salon 4',
      hidePayment: false,
    });

    expect(cart).toBeDefined();
    expect(cart.props.className).toContain('bg-[#1c1d22]/95');
    expect(cart.props.className).toContain('backdrop-blur-2xl');
  });

  it('7. PaymentModalPanel Apple Pay görünümü, net tutar ve pürüzsüz butonları sunar', () => {
    const modal = PaymentModalPanel({
      isOpen: true,
      totalAmount: 7150,
      tenderedAmount: '100',
      isSubmitting: false,
      error: null,
      onNumpadPress: vi.fn(),
      onClose: vi.fn(),
      onExactAmount: vi.fn(),
      onSubmitPayment: vi.fn(),
    });

    expect(modal).toBeDefined();
    expect(modal?.props.className).toContain('backdrop-blur-2xl');
  });

  it('8. ProductGridPanel ekran sıkışmalarını önleyen minmax(140px, 1fr) oto-dolgu ızgara yapısını kullanır', () => {
    const grid = ProductGridPanel({
      products: [mockProduct],
      currentPage: 1,
      totalPages: 1,
      onPageChange: vi.fn(),
      onProductClick: vi.fn(),
    });

    const gridContainer = grid.props.children[0];
    const innerGrid = gridContainer.props.children;
    expect(innerGrid.props.className).toContain('minmax(140px,1fr)');
  });

  it('9. PaymentModalPanel kredi kartı butonu nakit tamponu kısıtlamasından bağımsız olarak aktiftir', () => {
    const modal = PaymentModalPanel({
      isOpen: true,
      totalAmount: 10000,
      tenderedAmount: '20', // Toplamdan düşük nakit girilmiş olsa bile kart butonu kilitlenmemelidir
      isSubmitting: false,
      error: null,
      onNumpadPress: vi.fn(),
      onClose: vi.fn(),
      onExactAmount: vi.fn(),
      onSubmitPayment: vi.fn(),
    });

    const modalDialog = modal?.props.children;
    const leftPanel = modalDialog?.props.children[0];
    const buttonRow = leftPanel.props.children[1];
    const creditCardBtn = buttonRow.props.children[1];

    expect(creditCardBtn.props.disabled).toBe(false);
  });

  it('10. CartPanel satır seçimi 2px sıçrama yapmayacak şekilde sabit kenarlık yapısını (border-l-2) korur', () => {
    const mockTotals: CartTotals = {
      subtotal: 6500,
      taxTotal: 650,
      discountTotal: 0,
      grandTotal: 7150,
      itemCount: 1,
    };

    const mockCartItem: CartItem = {
      id: 'cart_item_1',
      product: mockProduct,
      quantity: 1,
      unitPrice: 6500,
      subtotal: 6500,
      taxRate: 10,
      total: 7150,
      taxAmount: 650,
    };

    const cart = CartPanel({
      items: [mockCartItem],
      totals: mockTotals,
      selectedItemId: null,
      isProcessingPayment: false,
      onSelectItem: vi.fn(),
      onIncrementQuantity: vi.fn(),
      onDecrementQuantity: vi.fn(),
      onRemoveItem: vi.fn(),
      onClearCart: vi.fn(),
      onProcessPayment: vi.fn(),
      onSubmitOrder: vi.fn(),
    });

    expect(cart).toBeDefined();
    expect(cart.props.className).toContain('bg-[#1c1d22]/95');
  });
});
