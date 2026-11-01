import React, { useEffect, useState } from 'react';
import { useFloorStore } from '../../stores/floorStore';
import { usePosStore } from '../../stores/posStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { AddTableModal } from './AddTableModal';
import type { FloorTable } from '../../types/floor';
import { TableCardGrid } from './TableCardGrid';
import { FloorBlueprint } from './FloorBlueprint';
import { TableSlideOver } from './TableSlideOver';
import { ReservationModal } from './ReservationModal';
import { Button } from '../../ui/Button';
import { OrderStatusBanner } from '../pos/OrderStatusBanner';
import { useSyncStore } from '../../stores/syncStore';

const CLUSTER_REFRESH_MS = 3000;

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
    checkReservationLocks,
    floorError,
  } = useFloorStore();

  const { openOrderForTable, openWalkinOrder } = usePosStore();
  const { setActiveModule, openModal } = useUIStore();
  const { user } = useAuthStore();
  const isOpen = useUIStore((state) => state.activeModule === 'FLOOR');
  const isCluster = useSyncStore((state) => state.status?.mode === 'CLUSTER');

  const [isResModalOpen, setIsResModalOpen] = useState(false);
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      checkReservationLocks();
    }, 15000);
    return () => clearInterval(interval);
  }, [checkReservationLocks]);

  // Modül gizli kalarak açık durur: salon her girişte sunucudan okunur.
  useEffect(() => {
    if (isOpen) void loadFloorPlan();
  }, [isOpen, loadFloorPlan]);

  // Başka cihazın açtığı masa beklemeden görünür. Kroki düzenlenirken tazelenmez:
  // sürüklenen masa eski konumuna atlar.
  useEffect(() => {
    if (!isOpen || !isCluster || isKrokiEditMode) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadFloorPlan();
    }, CLUSTER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isOpen, isCluster, isKrokiEditMode, loadFloorPlan]);

  const isOwnerOrManager = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'MASTER';

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
      <AddTableModal isOpen={isAddTableOpen} onClose={() => setIsAddTableOpen(false)} />
      <div className="px-5 pt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 shrink-0 border-b-2 border-[var(--border)]">
        <div className="flex items-center gap-6 overflow-x-auto" role="group" aria-label="Bölge">
          <button type="button" className="desk-tab text-lg tabular-nums" aria-pressed={selectedZoneId === null} onClick={() => setSelectedZoneId(null)}>
            Tümü ({tables.length})
          </button>
          {zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className="desk-tab text-lg tabular-nums"
              aria-pressed={selectedZoneId === zone.id}
              onClick={() => setSelectedZoneId(zone.id)}
            >
              {zone.name} ({tables.filter((t) => t.zoneId === zone.id).length})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap pb-2">
          {isOwnerOrManager ? (
            <Button variant="ghost" size="sm" onClick={() => setIsAddTableOpen(true)}>
              Masa Ekle
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={viewMode === 'KROKI'}
            onClick={() => {
              setKrokiEditMode(false);
              setViewMode(viewMode === 'CARDS' ? 'KROKI' : 'CARDS');
            }}
          >
            {viewMode === 'CARDS' ? 'Salon Planı' : 'Kart Görünümü'}
          </Button>
          {viewMode === 'KROKI' && isOwnerOrManager ? (
            <Button variant={isKrokiEditMode ? 'primary' : 'secondary'} size="sm" onClick={() => setKrokiEditMode(!isKrokiEditMode)}>
              {isKrokiEditMode ? 'Düzenlemeyi Bitir' : 'Planı Düzenle'}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setIsResModalOpen(true)}>
            Rezervasyon
          </Button>
          <Button variant="primary" size="sm" onClick={handleWalkin}>
            Tezgah Satışı
          </Button>
        </div>
      </div>

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
          onSaveLayout={saveFloorLayout}
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
      />

      {/* Rezervasyon Ekleme Modalı */}
      <ReservationModal
        isOpen={isResModalOpen}
        onClose={() => setIsResModalOpen(false)}
        tables={tables}
        onSaveReservation={addReservation}
      />
    </section>
  );
};
