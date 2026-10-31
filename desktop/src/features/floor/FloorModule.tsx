import React, { useEffect, useState } from 'react';
import { ShoppingBag, Calendar, MapPin, Grid } from 'lucide-react';
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
      {/* Üst Operasyon Barı */}
      <div className="bg-[var(--bg-panel)] border-b border-[var(--border)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Sol: Bölge Filtreleri */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <Button
            variant={selectedZoneId === null ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSelectedZoneId(null)}
            className="!min-h-12 tabular-nums"
          >
            Tümü ({tables.length})
          </Button>
          {zones.map((zone) => {
            const count = tables.filter((t) => t.zoneId === zone.id).length;
            const isSelected = selectedZoneId === zone.id;
            return (
              <Button
                key={zone.id}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelectedZoneId(zone.id)}
                className="!min-h-12 tabular-nums"
              >
                {zone.name} ({count})
              </Button>
            );
          })}
        </div>

        {/* Sağ: Görünüm Şalteri, Tezgah Satışı ve Rezervasyon */}
        <div className="flex items-center gap-2 flex-wrap">
          {isOwnerOrManager ? (
            <Button variant="secondary" size="sm" onClick={() => setIsAddTableOpen(true)} className="min-h-12 text-xs font-bold">
              Masa Ekle
            </Button>
          ) : null}
          <div className="p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setViewMode('CARDS');
                setKrokiEditMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 ${
                viewMode === 'CARDS'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Kart Görünümü</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('KROKI')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 ${
                viewMode === 'KROKI'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Salon Krokisi</span>
            </button>
          </div>

          {/* Kroki Düzenleme Butonu (Yalnızca kroki görünümünde ve yetkili kullanıcıda) */}
          {viewMode === 'KROKI' && isOwnerOrManager ? (
            <Button
              variant={isKrokiEditMode ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setKrokiEditMode(!isKrokiEditMode)}
              className="!min-h-12"
            >
              {isKrokiEditMode ? 'Düzenlemeyi Bitir' : 'Krokiyi Düzenle'}
            </Button>
          ) : null}

          {/* Hızlı Tezgah Satışı */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleWalkin}
            className="!min-h-12"
          >
            <ShoppingBag className="w-4 h-4 text-[var(--accent-amber)]" />
            <span>Tezgah Satışı</span>
          </Button>

          {/* Yeni Rezervasyon */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsResModalOpen(true)}
            className="!min-h-12"
          >
            <Calendar className="w-4 h-4" />
            <span>+ Rezervasyon</span>
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
