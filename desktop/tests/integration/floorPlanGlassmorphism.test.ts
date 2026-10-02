
import React from 'react';
import { renderToString } from 'react-dom/server';
import { TableCard } from '../../src/presentation/components/floor/ui/TableCard';
import { FloorPlanPanel, TableItem } from '../../src/presentation/components/floor/ui/FloorPlanPanel';
import { TableActionModal } from '../../src/presentation/components/floor/ui/TableActionModal';
import { FloorPlanContainer } from '../../src/presentation/components/floor/FloorPlanContainer';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { useFloorStore } from '../../src/presentation/store/useFloorStore';

describe('Masalar (Floor Plan) — macOS Frosted Glass & İş Akışı Düzenlemeleri', () => {
  beforeEach(() => {
    (useAuthStore as any).getInitialState = () => useAuthStore.getState();
    (useFloorStore as any).getInitialState = () => useFloorStore.getState();

    useAuthStore.setState({
      user: {
        userId: 'usr_waiter',
        tenantId: 'DEFAULT_TENANT',
        role: 'WAITER',
        name: 'Ahmet Garson',
      },
      isAuthenticated: true,
    });
  });

  describe('1. Zemin ve Renk Standardı (Frosted Glass)', () => {
    it('FloorPlanContainer koyu modda dark:bg-[#060609] ve açık modda bg-[#f5f5f7] zeminini kullanır', () => {
      const html = renderToString(React.createElement(FloorPlanContainer));
      expect(html).toContain('dark:bg-[#060609]');
      expect(html).toContain('bg-[#f5f5f7]');
    });

    it('TableCard katı renk yerine renksiz şeffaf cam (dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl) kullanır', () => {
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
        waiterName: 'Ahmet',
        totalAmount: 15000,
      };
      const html = renderToString(React.createElement(TableCard, { table: mockTable, onClick: vi.fn() }));
      expect(html).toContain('dark:bg-white/[0.04]');
      expect(html).toContain('bg-white/75');
      expect(html).toContain('backdrop-blur-xl');
      expect(html).toContain('dark:border-white/10');
      expect(html).toContain('border-black/[0.08]');
    });

    it('TableActionModal renksiz şeffaf frosted glass kabuğu kullanır', () => {
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
        waiterName: 'Ahmet',
        totalAmount: 15000,
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: mockTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );
      expect(html).toContain('dark:bg-white/[0.04]');
      expect(html).toContain('bg-white/85');
      expect(html).toContain('backdrop-blur-2xl');
      expect(html).not.toContain('bg-[#16171b]');
    });
  });

  describe('2. Masalar Sayfası Temizliği', () => {
    it('Operasyonel Masalar sayfasında "+ Yeni Masa Ekle" butonu yer almaz', () => {
      // Müdür rolünde bile operasyonel masalar sayfasında yeni masa butonu görünmemeli
      useAuthStore.setState({
        user: {
          userId: 'usr_manager',
          tenantId: 'DEFAULT_TENANT',
          role: 'MANAGER',
          name: 'Mehmet Müdür',
        },
        isAuthenticated: true,
      });

      const html = renderToString(React.createElement(FloorPlanContainer));
      expect(html).not.toContain('Yeni Masa');
      expect(html).not.toContain('Yeni Masa Ekle');
    });

    it('Masa kartı üzerindeki hover Düzenle (kalem) ve Sil (çöp kutusu) butonları kaldırılmıştır', () => {
      const mockTables: TableItem[] = [
        { id: 't-1', name: 'Masa 1', status: 'occupied' },
        { id: 't-2', name: 'Masa 2', status: 'empty' },
      ];
      const html = renderToString(
        React.createElement(FloorPlanPanel, {
          tables: mockTables,
          onTableClick: vi.fn(),
        })
      );
      expect(html).not.toContain('Masa Adını Düzenle');
      expect(html).not.toContain('Masayı Sil');
      expect(html).not.toContain('lucide-trash-2');
    });
  });

  describe('3. Masa Kartı (TableCard) Detayları', () => {
    it('Masayı açan garsonun adı Garson: Formatında açıkça gösterilir', () => {
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
        waiterName: 'Ahmet',
        totalAmount: 25000,
      };
      const html = renderToString(React.createElement(TableCard, { table: mockTable, onClick: vi.fn() }));
      expect(html).toContain('Garson: Ahmet');
    });

    it('Masa birleştirildiyse tek kart üzerinde birleşen masalar yazar (Masa 1 + Masa 2)', () => {
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
        waiterName: 'Ahmet',
        totalAmount: 35000,
        mergedWith: ['Masa 2'],
      };
      const html = renderToString(React.createElement(TableCard, { table: mockTable, onClick: vi.fn() }));
      expect(html).toContain('Masa 1 + Masa 2');
    });

    it('Masa taşındıysa kart altında transfer bilgisi yazar (Masa 2 ➔ Masa 6)', () => {
      const mockTable: TableItem = {
        id: 't-6',
        name: 'Masa 6',
        status: 'occupied',
        waiterName: 'Ahmet',
        totalAmount: 18000,
        transferInfo: 'Masa 2 ➔ Masa 6',
      };
      const html = renderToString(React.createElement(TableCard, { table: mockTable, onClick: vi.fn() }));
      expect(html).toContain('Masa 2 ➔ Masa 6');
    });

    it('Masa kartları dengeli ve orantılı grid ızgarasında sunulur', () => {
      const mockTables: TableItem[] = [
        { id: 't-1', name: 'Masa 1', status: 'empty' },
        { id: 't-2', name: 'Masa 2', status: 'occupied' },
      ];
      const html = renderToString(React.createElement(FloorPlanPanel, { tables: mockTables, onTableClick: vi.fn() }));
      expect(html).toContain('grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6');
    });
  });

  describe('4. Masa İşlem Modalı (TableActionModal)', () => {
    it('"Masa Adı Değiştir" butonu modaldan tamamen kaldırılmıştır', () => {
      // Müdür rolünde bile Masa Adı Değiştir butonu görünmemeli
      useAuthStore.setState({
        user: {
          userId: 'usr_manager',
          tenantId: 'DEFAULT_TENANT',
          role: 'MANAGER',
          name: 'Müdür',
        },
        isAuthenticated: true,
      });
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: mockTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );
      expect(html).not.toContain('Masa Adı Değiştir');
    });

    it('Garson rolündeyken "Adisyon Yazdır" butonu kaldırılır ve dolu masada rezervasyon aksiyonu GÖRÜNMEZ (Spec §11)', () => {
      useAuthStore.setState({
        user: {
          userId: 'usr_waiter',
          tenantId: 'DEFAULT_TENANT',
          role: 'WAITER',
          name: 'Garson Ali',
        },
        isAuthenticated: true,
      });

      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: mockTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );
      // Garson için Adisyon Yazdır gizlenmeli
      expect(html).not.toContain('Adisyon Yazdır');
      // İzinli operasyonel işlemler mevcut olmalı
      expect(html).toContain('Sipariş Ekle');
      expect(html).toContain('Masa Taşı');
      expect(html).toContain('Masaları Birleştir');
      // Faz 8: dolu masa rezerve edilemez. Buton önceden "pasif" olarak
      // render ediliyordu (disabled) ve tıklanabilir görünüyordu; şimdi hiç
      // render edilmez.
      expect(html).not.toContain('Rezerve Et');
      expect(html).not.toContain('Rezervasyonu Kaldır');
    });

    it('Rezerve masada garson için yalnız rezervasyon aksiyonları görünür (Spec §11)', () => {
      useAuthStore.setState({
        user: {
          userId: 'usr_waiter',
          tenantId: 'DEFAULT_TENANT',
          role: 'WAITER',
          name: 'Garson Ali',
        },
        isAuthenticated: true,
      });

      const reservedTable: TableItem = {
        id: 't-2',
        name: 'Masa 2',
        status: 'reserved',
        reservation: {
          customerName: 'Ayşe Yılmaz',
          partySize: 4,
          waitingSince: Date.now(),
          status: 'ACTIVE',
          reservedAtLabel: '02.10 20:30',
        },
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: reservedTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );

      // Rezervasyon bilgisi kullanıcıya gösterilir.
      expect(html).toContain('Ayşe Yılmaz');
      // Gerçek aksiyonlar sunulur.
      expect(html).toContain('Müşteri Geldi');
      expect(html).toContain('Rezervasyonu Kaldır');
      expect(html).toContain('Müşteri Gelmedi');
      // "Geldi" işaretlenmeden adisyon açılmaz.
      expect(html).not.toContain('Sipariş Ekle');
    });

    it('Kasiyer ve Yönetici rolündeyken dolu masada "Adisyon Yazdır" butonu görüntülenir', () => {
      useAuthStore.setState({
        user: {
          userId: 'usr_cashier',
          tenantId: 'DEFAULT_TENANT',
          role: 'CASHIER',
          name: 'Kasiyer Fatma',
        },
        isAuthenticated: true,
      });

      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: mockTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );
      expect(html).toContain('Adisyon Yazdır');
      expect(html).toContain('Tahsilat / Ödeme');
    });

    it('"Sipariş Ekle" butonu modaldan tetiklenebilir durumdadır', () => {
      const mockTable: TableItem = {
        id: 't-1',
        name: 'Masa 1',
        status: 'occupied',
      };
      const html = renderToString(
        React.createElement(TableActionModal, {
          table: mockTable,
          isOpen: true,
          onClose: vi.fn(),
          onAction: vi.fn(),
        })
      );
      expect(html).toContain('Sipariş Ekle');
    });
  });
});
