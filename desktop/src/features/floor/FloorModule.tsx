import React, { useEffect, useState } from 'react';
import { useFloorStore } from '../../stores/floorStore';
import { usePosStore } from '../../stores/posStore';
import { useKdsStore } from '../../stores/kdsStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { TableManagerModal } from './TableManagerModal';
import type { FloorTable } from '../../types/floor';
import { TableCardGrid } from './TableCardGrid';
import { FloorBlueprint } from './FloorBlueprint';
import { TableSlideOver } from './TableSlideOver';
import { ReservationModal } from './ReservationModal';
import { Bar, BarAction, BarTab } from '../../ui/Bar';
import { OrderStatusBanner } from '../pos/OrderStatusBanner';
import { useSyncStore } from '../../stores/syncStore';

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
    isKrokiEditMode,
    isSlideOverOpen,
    loadFloorPlan,
    setSelectedZoneId,
    openTableSlideOver,
    closeTableSlideOver,
    setViewMode,
    setKrokiEditMode,
    updateTablePosition,
    saveFloorLayout,
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
  const { user } = useAuthStore();
  const isOpen = useUIStore((state) => state.activeModule === 'FLOOR');
  const isCluster = useSyncStore((state) => state.status?.mode === 'CLUSTER');

  const [isResModalOpen, setIsResModalOpen] = useState(false);
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);

  // Modül gizli kalarak açık durur: salon her girişte sunucudan okunur.
  useEffect(() => {
    if (isOpen) void loadFloorPlan();
  }, [isOpen, loadFloorPlan]);

  // Başka cihazın açtığı masa beklemeden görünür. Kroki düzenlenirken tazelenmez:
  // sürüklenen masa eski konumuna atlar.
  useEffect(() => {
    if (!isOpen || isKrokiEditMode) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadFloorPlan();
    }, isCluster ? CLUSTER_REFRESH_MS : RESERVATION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isOpen, isCluster, isKrokiEditMode, loadFloorPlan]);

  const isOwnerOrManager = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'MASTER';
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
      <TableManagerModal isOpen={isAddTableOpen} onClose={() => setIsAddTableOpen(false)} />
      <Bar
        label="Bölgeler"
        actions={
          <>
            {isOwnerOrManager ? <BarAction onClick={() => setIsAddTableOpen(true)}>Masalar</BarAction> : null}
            <BarAction
              onClick={() => {
                setViewMode(viewMode === 'CARDS' ? 'KROKI' : 'CARDS');
                setKrokiEditMode(false);
              }}
            >
              {viewMode === 'CARDS' ? 'Kroki' : 'Kartlar'}
            </BarAction>
            {viewMode === 'KROKI' && isOwnerOrManager ? (
              <BarAction
                aria-pressed={isKrokiEditMode}
                onClick={() => {
                  // Yerleşim Bitir ile kaydedilir; kaydedilemezse düzenleme açık kalır, emek gitmez.
                  if (!isKrokiEditMode) setKrokiEditMode(true);
                  else void saveFloorLayout().then((saved) => saved && setKrokiEditMode(false));
                }}
              >
                {isKrokiEditMode ? 'Bitir' : 'Düzenle'}
              </BarAction>
            ) : null}
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

      {/* Görünüm Alanı: Kart Izgarası veya 2D Kroki */}
      {viewMode === 'CARDS' ? (
        <TableCardGrid
          tables={filteredTables}
          onOpenTable={handleOpenTable}
          onInspectTable={handleInspectTable}
        />
      ) : (
        <FloorBlueprint
          tables={filteredTables}
          isEditMode={isKrokiEditMode}
          onTablePositionChange={updateTablePosition}
          onOpenTable={handleOpenTable}
          onInspectTable={handleInspectTable}
        />
      )}

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
