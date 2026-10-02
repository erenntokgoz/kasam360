// Faz 8 — Rezervasyon akışı sözleşme testleri (Spec §11).
//
// Kapsam karar kurallarıdır:
// 1. **Dolu masa rezerve edilemez** ve arayüzde rezervasyon aksiyonu yoktur.
// 2. **Boş masa hızlı rezerve edilir**; kayıt müşteri adı ve randevu saatiyle yazılır.
// 3. **Kaldırma gerçek bir işlemdir:** kayıt kapanır, masa `AVAILABLE` olur.
// 4. **Müşteri geldi / gelmedi ayrı kayıtlardır.** "Geldi" masayı işgal etmez.
// 5. **Kiracı kapısı:** tenant'sız ve yetkisiz istek reddedilir.
// 6. **Sözleşme dürüstlüğü:** bilinmeyen/kapanmış durum arayüzde "Rezerve"
//    diye uydurulmaz.

import { renderToString } from 'react-dom/server';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tauriInvoke } from '../../src/data/ipc/tauriInvoke';
import { useFloorStore } from '../../src/presentation/store/useFloorStore';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { TableCard } from '../../src/presentation/components/floor/ui/TableCard';
import { TableItem } from '../../src/presentation/components/floor/ui/FloorPlanPanel';

const TENANT = 'DEFAULT_TENANT';

function signIn(role: 'OWNER' | 'MANAGER' | 'WAITER' | 'CASHIER' = 'OWNER') {
  useAuthStore.setState({
    user: { userId: 'usr_rsv_test', role, name: 'Test Kullanıcı', tenantId: TENANT },
    isAuthenticated: true,
    isLocked: false,
  });
}

async function createEmptyTable(name: string): Promise<string> {
  const id = `tbl_rsv_${name}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  await useFloorStore.getState().addTable(id, name);
  return id;
}

async function reserveTableFor(tableId: string, customerName = 'Ayşe Yılmaz') {
  return useFloorStore.getState().reserveTable(tableId, {
    customerName,
    partySize: 4,
    reservedAt: new Date(Date.now() + 1800000).toISOString(),
  });
}

describe('Faz 8 — Rezervasyon akışı', () => {
  beforeEach(() => {
    signIn('OWNER');
    useFloorStore.setState({
      tables: [],
      reservations: [],
      isLoading: false,
      error: null,
      readyStatuses: {},
      isClockedIn: false,
    });
  });

  it('boş masa rezerve edilir, kayıt masa ve salon planı ile birlikte güncellenir', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Rezervasyon Test 1');

    const created = await reserveTableFor(tableId, 'Ayşe Yılmaz');

    expect(created.tableId).toBe(tableId);
    expect(created.status).toBe('ACTIVE');
    expect(created.customerName).toBe('Ayşe Yılmaz');
    expect(created.partySize).toBe(4);

    const state = useFloorStore.getState();
    expect(state.tables.find((t) => t.id === tableId)?.status).toBe('RESERVED');
    expect(state.reservationForTable(tableId)?.customerName).toBe('Ayşe Yılmaz');
  });

  it('dolu masaya rezervasyon yazılamaz (kapı CONFLICT)', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Dolu Masa Testi');

    // Masa önce siparişle doldurulur; rezervasyon yazmak artık mümkün olmamalı.
    await tauriInvoke('submit_order', {
      payload: {
        orderId: `ord_rsv_${Date.now()}`,
        tableId,
        items: [],
      },
      tenantId: TENANT,
    });
    const afterOrder = useFloorStore.getState().tables.find((t) => t.id === tableId);
    if (afterOrder?.status !== 'OCCUPIED') {
      // Sipariş mock'u masayı doldurmadıysa kapı elle doğrulanır.
      await tauriInvoke('update_table_status', { tableId, status: 'OCCUPIED', tenantId: TENANT });
    }

    const error = await reserveTableFor(tableId).then(
      () => null,
      (err: unknown) => String(err)
    );
    expect(error).toContain('CONFLICT');
  });

  it('rezervasyon kaldırılır: kayıt kapanır ve masa tekrar boş olur', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Kaldırma Testi');
    const created = await reserveTableFor(tableId);

    await useFloorStore.getState().cancelReservation(created.id);

    const state = useFloorStore.getState();
    expect(state.tables.find((t) => t.id === tableId)?.status).toBe('AVAILABLE');
    expect(state.reservations.find((r) => r.id === created.id)).toBeUndefined();
  });

  it('müşteri geldi işaretlemesi masayı işgal etmez, yalnız durumu değiştirir', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Gelen Müşteri Testi');
    const created = await reserveTableFor(tableId, 'Ali Kaya');

    await useFloorStore.getState().markReservationArrived(created.id);

    const state = useFloorStore.getState();
    const record = state.reservations.find((r) => r.id === created.id);
    expect(record?.status).toBe('ARRIVED');
    // Masa ancak sipariş açıldığında OCCUPIED olur.
    expect(state.tables.find((t) => t.id === tableId)?.status).toBe('RESERVED');
  });

  it('müşteri gelmedi kaydı NO_SHOW olarak kapanır', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Gelmedi Testi');
    const created = await reserveTableFor(tableId, 'Zeynep Demir');

    await useFloorStore.getState().markReservationNoShow(created.id);

    const state = useFloorStore.getState();
    expect(state.tables.find((t) => t.id === tableId)?.status).toBe('AVAILABLE');
    expect(state.reservations.find((r) => r.id === created.id)).toBeUndefined();
  });

  it('rezervasyon yetkisi olmayan rolde reddedilir (kasa rezervasyon yönetmez)', async () => {
    signIn('CASHIER');
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Kasa Rolü Testi');

    const error = await reserveTableFor(tableId).then(
      () => null,
      (err: unknown) => String(err)
    );
    expect(error).toContain('UNAUTHORIZED');
  });

  it('tenant olmadan rezervasyon okunamaz (fail-closed)', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });

    const error = await tauriInvoke('get_reservations', { tenantId: '' }).then(
      () => null,
      (err: unknown) => String(err)
    );
    expect(error).toContain('UNAUTHORIZED');
  });

  it('kapatılan rezervasyon ikinci kez kapatılamaz', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Çift Kapatma Testi');
    const created = await reserveTableFor(tableId);
    await useFloorStore.getState().cancelReservation(created.id);

    const error = await useFloorStore
      .getState()
      .cancelReservation(created.id)
      .then(
        () => null,
        (err: unknown) => String(err)
      );
    expect(error).toContain('CONFLICT');
  });

  it('müşteri adı olmadan rezervasyon yazılamaz', async () => {
    await useFloorStore.getState().fetchFloorPlan();
    const tableId = await createEmptyTable('Adsız Müşteri Testi');

    const error = await useFloorStore
      .getState()
      .reserveTable(tableId, { customerName: '   ', partySize: 2, reservedAt: new Date().toISOString() })
      .then(
        () => null,
        (err: unknown) => String(err)
      );
    expect(error).toContain('VALIDATION');
  });
});

describe('Faz 8 — Rezervasyon kartı ve zamanlayıcı', () => {
  const reservedTable: TableItem = {
    id: 't-rsv',
    name: 'Masa 7',
    status: 'reserved',
    reservation: {
      customerName: 'Ayşe Yılmaz',
      partySize: 4,
      waitingSince: Date.now() - 36 * 60000,
      status: 'ACTIVE',
      reservedAtLabel: '02.10 20:30',
    },
  };

  it('rezerve kartı müşteri adını ve kişi sayısını gösterir', () => {
    const html = renderToString(React.createElement(TableCard, { table: reservedTable, onClick: vi.fn() }));
    expect(html).toContain('Ayşe Yılmaz');
    expect(html).toContain('4 kişi');
    expect(html).toContain('REZERVE');
  });

  it('rezervasyon kaydı yoksa kart boş etikete düşmez, eksikliği yazar', () => {
    const orphan: TableItem = { id: 't-orphan', name: 'Masa 8', status: 'reserved' };
    const html = renderToString(React.createElement(TableCard, { table: orphan, onClick: vi.fn() }));
    expect(html).toContain('Rezervasyon kaydı bulunamadı');
  });

  it('36 dakika bekleyen rezervasyon 35dk hareketsizlik uyarısını tetikler', () => {
    const html = renderToString(React.createElement(TableCard, { table: reservedTable, onClick: vi.fn() }));
    // 35 dk eşiğini aşan bekleme sarı pulse rozetine düşer (animate-pulse).
    expect(html).toContain('animate-pulse');
  });

  it('boş masada hızlı rezerve ikonu bulunur, dolu ve rezerve masada bulunmaz', () => {
    const empty = renderToString(
      React.createElement(TableCard, {
        table: { id: 't-empty', name: 'Masa 9', status: 'empty' } as TableItem,
        onClick: vi.fn(),
        onQuickReserve: vi.fn(),
      })
    );
    expect(empty).toContain('hızlı rezerve et');

    const occupied = renderToString(
      React.createElement(TableCard, {
        table: { id: 't-occ', name: 'Masa 10', status: 'occupied' } as TableItem,
        onClick: vi.fn(),
        onQuickReserve: vi.fn(),
      })
    );
    expect(occupied).not.toContain('hızlı rezerve et');
  });
});
