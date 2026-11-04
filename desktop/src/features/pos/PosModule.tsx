import React, { useEffect, useState } from 'react';
import { usePosStore } from '../../stores/posStore';
import { useFloorStore } from '../../stores/floorStore';
import { ProductCatalog } from './ProductCatalog';
import { OrderTicket } from './OrderTicket';
import { ModifierModal } from './ModifierModal';
import { OrderStatusBanner } from './OrderStatusBanner';
import { Modal } from '../../ui/Modal';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useSyncStore } from '../../stores/syncStore';
import { Button } from '../../ui/Button';

const WATCH_MS = 3000;

export const PosModule: React.FC = () => {
  const {
    loadCatalog,
    activeModifierProduct,
    closeModifierModal,
    addItemToTicket,
    bindWalkinToTable,
    watchActiveOrder,
    activeTableId,
    isWalkin,
  } = usePosStore();

  const { tables } = useFloorStore();
  const isOpen = useUIStore((state) => state.activeModule === 'POS');
  const userId = useAuthStore((state) => state.user?.userId);
  const isCluster = useSyncStore((state) => state.status?.mode === 'CLUSTER');
  const [showBindModal, setShowBindModal] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  // Modül gizli kalarak açık durur: menüdeki değişiklik her girişte buraya yansır.
  useEffect(() => {
    if (isOpen && userId) void loadCatalog().catch(() => undefined);
  }, [loadCatalog, isOpen, userId]);

  // Tek cihazda adisyonu değiştirecek başka biri yoktur, boşuna okunmaz.
  useEffect(() => {
    if (!isOpen || !isCluster) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void watchActiveOrder();
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [isOpen, isCluster, watchActiveOrder]);

  const handleBindConfirm = () => {
    const table = tables.find((t) => t.id === targetTableId);
    if (!table) return;
    void bindWalkinToTable(table.id, table.tableNumber);
    setShowBindModal(false);
  };

  return (
    <section className="flex-1 flex flex-col min-w-0 h-full overflow-hidden select-none">
      <OrderStatusBanner className="m-2 mb-0 shrink-0" />
      <div className="flex-1 flex min-h-0">
        {/* Sol/Orta Katalog */}
        <ProductCatalog onBindTableClick={() => setShowBindModal(true)} />

        {/* Sağ Adisyon Paneli */}
        {activeTableId || isWalkin ? <OrderTicket /> : null}
      </div>

      {/* Modifiyer Seçici Modalı */}
      <ModifierModal
        isOpen={!!activeModifierProduct}
        product={activeModifierProduct}
        onClose={closeModifierModal}
        onConfirm={(modData) => {
          if (!activeModifierProduct) return;
          addItemToTicket(
            activeModifierProduct,
            modData.selectedModifiers,
            modData.cookingDegree,
            modData.notes
          );
        }}
      />

      {/* Tezgah Satışını Masaya Bağlama Modalı */}
      <Modal
        isOpen={showBindModal}
        onClose={() => setShowBindModal(false)}
        title="Tezgah Satışını Masaya Aktar"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Hedef Masa Seçin
            </label>
            <select
              value={targetTableId}
              onChange={(e) => setTargetTableId(e.target.value)}
              className="w-full min-h-12 px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
            >
              <option value="">Masa seçin...</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tableNumber} ({t.zoneName} · {t.status === 'EMPTY' ? 'Boş' : 'Dolu'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => setShowBindModal(false)} className="flex-1">
              Vazgeç
            </Button>
            <Button
              variant="primary"
              onClick={handleBindConfirm}
              disabled={!targetTableId}
              className="flex-1"
            >
              Masaya Bağla
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
};
