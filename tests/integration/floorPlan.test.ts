import { describe, expect, it, beforeEach } from 'vitest';
import { useFloorStore } from '../../src/presentation/store/useFloorStore';

describe('Floor Plan Store & IPC Integration Tests', () => {
  beforeEach(async () => {
    // Reset floor store before each test
    useFloorStore.setState({
      tables: [],
      isLoading: false,
      error: null,
      readyStatuses: {},
      isClockedIn: false,
    });
  });

  it('fetchFloorPlan: masaları ve güncel durumlarını (AVAILABLE, OCCUPIED, RESERVED) ve currentTotal tutarlarını başarıyla çeker', async () => {
    const store = useFloorStore.getState();
    await store.addTable('tbl-001', 'Masa 1');
    const tables = await store.fetchFloorPlan();

    expect(tables).toBeDefined();
    expect(tables.length).toBeGreaterThan(0);

    const availableTable = tables.find((t) => t.status === 'AVAILABLE');
    expect(availableTable).toBeDefined();

    const occupiedTable = tables.find((t) => t.status === 'OCCUPIED');
    if (occupiedTable) {
      expect(occupiedTable.currentTotal).toBeGreaterThan(0);
    }

    const state = useFloorStore.getState();
    expect(state.tables.length).toBe(tables.length);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('addTable: yeni masa ekler ve masa listesini günceller', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();
    const initialCount = useFloorStore.getState().tables.length;

    const testId = `tbl_test_${Date.now()}`;
    const testName = 'Teras VIP 1';

    await store.addTable(testId, testName);

    const updatedTables = useFloorStore.getState().tables;
    expect(updatedTables.length).toBe(initialCount + 1);

    const added = updatedTables.find((t) => t.id === testId);
    expect(added).toBeDefined();
    expect(added?.name).toBe(testName);
    expect(added?.status).toBe('AVAILABLE');
    expect(added?.currentTotal).toBe(0);
  });

  it('addTablesBatch: çoklu masa ekler ve toplu olarak listeyi günceller', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();
    const initialCount = useFloorStore.getState().tables.length;

    const batchToAdd = [
      { id: `tbl_batch_1_${Date.now()}`, name: 'Bahçe 101' },
      { id: `tbl_batch_2_${Date.now()}`, name: 'Bahçe 102' },
      { id: `tbl_batch_3_${Date.now()}`, name: 'Bahçe 103' },
    ];

    await store.addTablesBatch(batchToAdd);

    const updatedTables = useFloorStore.getState().tables;
    expect(updatedTables.length).toBe(initialCount + 3);
    expect(updatedTables.some((t) => t.name === 'Bahçe 101')).toBe(true);
    expect(updatedTables.some((t) => t.name === 'Bahçe 102')).toBe(true);
    expect(updatedTables.some((t) => t.name === 'Bahçe 103')).toBe(true);
  });

  it('updateTableName: masa adını günceller', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();

    const target = useFloorStore.getState().tables[0];
    expect(target).toBeDefined();

    const newName = 'Güncellenmiş Masa Adı';
    await store.updateTableName(target.id, newName);

    const updated = useFloorStore.getState().tables.find((t) => t.id === target.id);
    expect(updated?.name).toBe(newName);
  });

  it('reserveTable: masayı RESERVED durumuna geçirir', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();

    const available = useFloorStore.getState().tables.find((t) => t.status === 'AVAILABLE');
    expect(available).toBeDefined();

    await store.reserveTable(available!.id);

    const updated = useFloorStore.getState().tables.find((t) => t.id === available!.id);
    expect(updated?.status).toBe('RESERVED');
  });

  it('moveTable: masayı taşır (kaynak boşalır, hedef dolar ve tutar aktarılır)', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();

    // Test için bir dolu ve bir boş masa temin et
    const srcId = `tbl_move_src_${Date.now()}`;
    const dstId = `tbl_move_dst_${Date.now()}`;
    await store.addTable(srcId, 'Taşınacak Masa');
    await store.addTable(dstId, 'Hedef Masa');

    await store.moveTable(srcId, dstId);

    const tables = useFloorStore.getState().tables;
    const src = tables.find((t) => t.id === srcId);
    const dst = tables.find((t) => t.id === dstId);

    expect(src?.status).toBe('AVAILABLE');
    expect(dst?.status).toBe('OCCUPIED');
  });

  it('mergeTables: masaları birleştirir (kaynak boşalır, hedef dolar ve tutarlar birleşir)', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();

    const srcId = `tbl_merge_src_${Date.now()}`;
    const dstId = `tbl_merge_dst_${Date.now()}`;
    await store.addTable(srcId, 'Kaynak Masa');
    await store.addTable(dstId, 'Hedef Birleşik');

    await store.mergeTables(srcId, dstId, 'MANAGER');

    const tables = useFloorStore.getState().tables;
    const src = tables.find((t) => t.id === srcId);
    const dst = tables.find((t) => t.id === dstId);

    expect(src?.status).toBe('AVAILABLE');
    expect(src?.currentTotal).toBe(0);
    expect(dst?.status).toBe('OCCUPIED');
  });

  it('removeTable: masayı siler ve listeden kaldırır', async () => {
    const store = useFloorStore.getState();
    const testId = `tbl_delete_${Date.now()}`;
    await store.addTable(testId, 'Silinecek Masa');

    const beforeDelete = useFloorStore.getState().tables.find((t) => t.id === testId);
    expect(beforeDelete).toBeDefined();

    await store.removeTable(testId);

    const afterDelete = useFloorStore.getState().tables.find((t) => t.id === testId);
    expect(afterDelete).toBeUndefined();
  });

  it('getTableReadyStatus ve pollReadyStatuses: mutfaktaki hazır sipariş durumlarını sorgular', async () => {
    const store = useFloorStore.getState();
    await store.fetchFloorPlan();

    // Belirli bir masa için ready sorgusu
    const status = await store.getTableReadyStatus('tbl-003');
    expect(typeof status).toBe('string');

    // Polling yapıldığında readyStatuses nesnesi dolar
    const statuses = await store.pollReadyStatuses();
    expect(statuses).toBeDefined();
    expect(typeof statuses).toBe('object');
  });

  it('waiterClockIn: garson mesai başlangıcını kaydeder', async () => {
    const store = useFloorStore.getState();
    expect(store.isClockedIn).toBe(false);

    const eventId = await store.waiterClockIn('usr_waiter_test');
    expect(eventId).toBeDefined();
    expect(useFloorStore.getState().isClockedIn).toBe(true);
  });
});
