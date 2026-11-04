import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { slideTables } from '../../lib/slideTables';
import { useFloorStore } from '../../stores/floorStore';
import { usePosStore } from '../../stores/posStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useUIStore } from '../../stores/uiStore';
import type { FloorTable } from '../../types/floor';
import { TableCardGrid } from './TableCardGrid';
import { FloorBlueprint } from './FloorBlueprint';
import { TableSlideOver } from './TableSlideOver';
import { ReservationModal } from './ReservationModal';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { OrderStatusBanner } from '../pos/OrderStatusBanner';
import { useSyncStore } from '../../stores/syncStore';

type TableFilter = 'ALL' | 'EMPTY' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED';

const FILTERS: { id: TableFilter; label: string }[] = [
  { id: 'ALL', label: 'Tümü' },
  { id: 'EMPTY', label: 'Boş' },
  { id: 'OCCUPIED', label: 'Dolu' },
  { id: 'BILL_REQUESTED', label: 'Hesap' },
  { id: 'RESERVED', label: 'Rezerve' },
];

const matchesFilter = (table: FloorTable, filter: TableFilter) => filter === 'ALL' || table.status === filter || (filter === 'RESERVED' && Boolean(table.reservationId));

const CLUSTER_REFRESH_MS = 3000;

const KITCHEN_POLL_MS = 15_000;
// Rezervasyon kapanma saati sunucuda hesaplanır; salon bu aralıkla yeniden okur.
const RESERVATION_REFRESH_MS = 30_000;

export const FloorModule: React.FC = () => {
  const {
    zones,
    tables,
    selectedZoneId,
    selectedTableId,
    viewMode,
    isSlideOverOpen,
    loadFloorPlan,
    setSelectedZoneId,
    openTableSlideOver,
    closeTableSlideOver,
    setViewMode,
    updateTablePosition,
    moveTable,
    mergeTables,
    addReservation,
    closeReservation,
    updateReservation,
    setBillRequested,
    floorError,
  } = useFloorStore();

  const { openOrderForTable, openWalkinOrder } = usePosStore();
  const setActiveModule = useUIStore((state) => state.setActiveModule);
  const openModal = useUIStore((state) => state.openModal);
  const isOpen = useUIStore((state) => state.activeModule === 'FLOOR');
  const isCluster = useSyncStore((state) => state.status?.mode === 'CLUSTER');

  const [isResModalOpen, setIsResModalOpen] = useState(false);
  const [filter, setFilter] = useState<TableFilter>('ALL');
  const cardsRef = useRef<HTMLDivElement>(null);
  const krokiRef = useRef<HTMLDivElement>(null);
  const shownView = useRef(viewMode);

  useLayoutEffect(() => {
    if (shownView.current === viewMode || !cardsRef.current || !krokiRef.current) return;
    shownView.current = viewMode;
    if (viewMode === 'KROKI') slideTables(cardsRef.current, krokiRef.current);
    else slideTables(krokiRef.current, cardsRef.current);
  }, [viewMode]);

  // Modül gizli kalarak açık durur: salon her girişte sunucudan okunur.
  useEffect(() => {
    if (isOpen) void loadFloorPlan();
  }, [isOpen, loadFloorPlan]);

  // Başka cihazın açtığı masa beklemeden görünür. Kroki düzenlenirken tazelenmez:
  // sürüklenen masa eski konumuna atlar.
  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !useFloorStore.getState().isKrokiEditMode) void loadFloorPlan();
    }, isCluster ? CLUSTER_REFRESH_MS : RESERVATION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isOpen, isCluster, loadFloorPlan]);

  const loadKitchen = useKdsStore((state) => state.loadTickets);
  const isSalonOpen = useUIStore((state) => state.activeModule === 'FLOOR');

  useEffect(() => {
    if (!isSalonOpen) return undefined;
    void loadKitchen().catch(() => undefined);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadKitchen().catch(() => undefined);
    }, KITCHEN_POLL_MS);
    return () => clearInterval(timer);
  }, [isSalonOpen, loadKitchen]);

  // Seçili bölgeye göre masaları filtrele
  const filteredTables = selectedZoneId
    ? tables.filter((t) => t.zoneId === selectedZoneId)
    : tables;

  const currentSelectedTable = tables.find((t) => t.id === selectedTableId) || null;

  const handleOpenTable = (table: FloorTable, guestCount: number) => {
    void openOrderForTable(table.id, table.tableNumber, guestCount);
    setActiveModule('POS');
  };

  const handleInspectTable = (table: FloorTable) => {
    openTableSlideOver(table.id);
  };

  const handleWalkin = () => {
    void openWalkinOrder();
    setActiveModule('POS');
  };

  const handleGoToPosFromDrawer = (table: FloorTable) => {
    closeTableSlideOver();
    void openOrderForTable(table.id, table.tableNumber, table.occupiedSeats || 2);
    setActiveModule('POS');
  };

  const handlePayFromDrawer = async (table: FloorTable) => {
    await openOrderForTable(table.id, table.tableNumber, table.occupiedSeats || 2);
    openModal('payment');
  };

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden select-none">
      <OrderStatusBanner className="m-2 mb-0 shrink-0" />
      {floorError ? (
        <p role="alert" className="m-3 p-3 rounded-lg text-xs font-medium break-words bg-[var(--accent-red-soft)] text-[var(--accent-red)] border border-[var(--accent-red-border)]">
          Salon planı okunamadı: {floorError}
        </p>
      ) : null}
      <Bar
        label="Bölgeler"
        actions={
          <>
            <BarAction onClick={() => setIsResModalOpen(true)}>Rezervasyon</BarAction>
            <BarAction tone="primary" onClick={handleWalkin}>Tezgah Satışı</BarAction>
          </>
        }
      >
        <BarTab active={selectedZoneId === null} onClick={() => setSelectedZoneId(null)}>Tümü</BarTab>
        {zones.map((zone) => (
          <BarTab key={zone.id} active={selectedZoneId === zone.id} onClick={() => setSelectedZoneId(zone.id)}>
            {zone.name}
          </BarTab>
        ))}
      </Bar>

      <div className="floor-tools">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label} <span className="tabular-nums">{filteredTables.filter((table) => matchesFilter(table, item.id)).length}</span>
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-pressed={viewMode === 'CARDS'} onClick={() => setViewMode('CARDS')}>Kartlar</button>
        <button type="button" aria-pressed={viewMode === 'KROKI'} onClick={() => setViewMode('KROKI')}>Kroki</button>
      </div>

      <div className="floor-views">
        <div>
          <div ref={cardsRef} className="floor-view" data-active={viewMode === 'CARDS'}>
            <TableCardGrid
              tables={filteredTables.filter((table) => matchesFilter(table, filter))}
              onOpenTable={handleOpenTable}
              onInspectTable={handleInspectTable}
            />
          </div>
          <div ref={krokiRef} className="floor-view" data-active={viewMode === 'KROKI'}>
            <FloorBlueprint
              zones={zones}
              tables={tables}
              zoneId={selectedZoneId}
              matches={(table) => matchesFilter(table, filter)}
              isEditMode={false}
              onTablePositionChange={updateTablePosition}
              onOpenTable={handleOpenTable}
              onInspectTable={handleInspectTable}
            />
          </div>
        </div>
      </div>

      {/* Sağdan Açılan Masa Çekmecesi */}
      <TableSlideOver
        isOpen={isSlideOverOpen}
        table={currentSelectedTable}
        allTables={tables}
        onClose={closeTableSlideOver}
        onGoToPos={handleGoToPosFromDrawer}
        onPayTable={handlePayFromDrawer}
        onMoveTable={moveTable}
        onMergeTable={mergeTables}
        onCloseReservation={closeReservation}
        onSeatReservation={(table, guests) => {
          closeTableSlideOver();
          handleOpenTable(table, guests);
        }}
        onToggleBill={setBillRequested}
      />

      {/* Rezervasyon Ekleme Modalı */}
      <ReservationModal
        isOpen={isResModalOpen}
        onClose={() => setIsResModalOpen(false)}
        tables={tables}
        onSaveReservation={addReservation}
        onUpdateReservation={updateReservation}
        onCloseReservation={closeReservation}
      />
    </section>
  );
};
