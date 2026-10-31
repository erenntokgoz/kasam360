import React, { useEffect, useState } from 'react';
import { usePosStore } from '../../stores/posStore';
import { useFloorStore } from '../../stores/floorStore';
import { ProductCatalog } from './ProductCatalog';
import { OrderTicket } from './OrderTicket';
import { ModifierModal } from './ModifierModal';
import { Modal } from '../../ui/Modal';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../../ui/Button';

export const PosModule: React.FC = () => {
  const {
    loadCatalog,
    activeModifierProduct,
    closeModifierModal,
    addItemToTicket,
    bindWalkinToTable,
  } = usePosStore();

  const { tables } = useFloorStore();
  const isOpen = useUIStore((state) => state.activeModule === 'POS');
  const userId = useAuthStore((state) => state.user?.userId);
  const [showBindModal, setShowBindModal] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  // Modül gizli kalarak açık durur: menüdeki değişiklik her girişte buraya yansır.
  useEffect(() => {
    if (isOpen && userId) void loadCatalog().catch(() => undefined);
  }, [loadCatalog, isOpen, userId]);

  const handleBindConfirm = () => {
    const table = tables.find((t) => t.id === targetTableId);
    if (!table) return;
    void bindWalkinToTable(table.id, table.tableNumber);
    setShowBindModal(false);
  };

  return (
    <section className="flex-1 flex min-w-0 h-full overflow-hidden select-none">
      {/* Sol/Orta Katalog */}
      <ProductCatalog onBindTableClick={() => setShowBindModal(true)} />

      {/* Sağ Adisyon Paneli */}
      <OrderTicket />

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
            modData.course,
            modData.notes
          );
        }}
      />

      {/* Tezgah Satışını Masaya Bağlama Modalı */}
      <Modal
        isOpen={showBindModal}
        onClose={() => setShowBindModal(false)}
        title="Tezgah Satışını Masaya Aktar"
        subtitle="Açık adisyonu salondaki bir masaya bağlayarak masadan takibe devam edin."
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
