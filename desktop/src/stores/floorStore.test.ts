import { describe, it, expect, beforeEach } from 'vitest';
import { useFloorStore } from './floorStore';
import type { FloorTable } from '../types/floor';

describe('floorStore - Masa Yönetimi ve Tahsilat Durumu', () => {
  const mockTable: FloorTable = {
    id: 'tbl_test',
    tableNumber: 'Masa 99',
    zoneId: 'zone_main',
    zoneName: 'Ana Salon',
    capacity: 4,
    status: 'OCCUPIED',
    totalCents: 100000,
    posX: 10,
    posY: 10,
    width: 100,
    height: 100,
    shape: 'RECT',
  };

  beforeEach(() => {
    useFloorStore.setState({
      tables: [{ ...mockTable }],
      zones: [],
      selectedZoneId: null,
      selectedTableId: null,
      isSlideOverOpen: false,
    });
  });

  it('tam hesap ödendiğinde masa EMPTY durumuna döner ve bakiye sıfırlanır', () => {
    useFloorStore.getState().updateTablePayment('tbl_test', 100000, true);

    const updated = useFloorStore.getState().tables.find((t) => t.id === 'tbl_test')!;
    expect(updated.status).toBe('EMPTY');
    expect(updated.totalCents).toBe(0);
  });

  it('kısmi ödeme yapıldığında masa OCCUPIED kalır ve bakiye düşer', () => {
    useFloorStore.getState().updateTablePayment('tbl_test', 40000, false);

    const updated = useFloorStore.getState().tables.find((t) => t.id === 'tbl_test')!;
    expect(updated.status).toBe('OCCUPIED');
    expect(updated.totalCents).toBe(60000);
  });

  it('60 dakika kuralı: 45 dk kala boş masa otomatik RESERVED rozeti alır ve kilitlenir', () => {
    const tableWithRes: FloorTable = {
      ...mockTable,
      id: 'tbl_res',
      status: 'EMPTY',
      totalCents: 0,
      reservedAt: new Date(Date.now() + 45 * 60000).toISOString(),
    };

    useFloorStore.setState({ tables: [tableWithRes] });
    useFloorStore.getState().checkReservationLocks();

    const locked = useFloorStore.getState().tables.find((t) => t.id === 'tbl_res')!;
    expect(locked.status).toBe('RESERVED');
  });
});
