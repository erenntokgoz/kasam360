import React, { useState } from 'react';
import { useFloorStore } from '../../../stores/floorStore';
import { Bar, BarTab } from '../../../ui/Bar';
import { Button } from '../../../ui/Button';
import { Modal } from '../../../ui/Modal';
import { FloorBlueprint } from '../../floor/FloorBlueprint';

/** Kanvas pencereye sığarken masa konumları kayıtlı koordinatlarında kalır. */
export const KrokiEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { zones, tables, loadFloorPlan, updateTablePosition, saveFloorLayout, setKrokiEditMode } = useFloorStore();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const close = () => {
    if (isBusy) return;
    // Kaydedilmeyen sürüklemeler atılır: ekranda kayıttaki düzen kalır.
    if (isDirty) void loadFloorPlan();
    onClose();
  };

  const save = async () => {
    setIsBusy(true);
    const saved = await saveFloorLayout();
    setKrokiEditMode(true);
    setIsBusy(false);
    if (saved) onClose();
  };

  return (
    <Modal cardFlow isOpen title="Krokiyi Düzenle" maxWidth="5xl" onClose={close}>
      <div className="flex h-[min(65vh,42rem)] min-h-48 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
        <Bar label="Kısımlar">
          <BarTab active={zoneId === null} onClick={() => setZoneId(null)}>Tümü</BarTab>
          {zones.map((zone) => (
            <BarTab key={zone.id} active={zoneId === zone.id} onClick={() => setZoneId(zone.id)}>
              {zone.name}
            </BarTab>
          ))}
        </Bar>
        <FloorBlueprint
          zones={zones}
          tables={tables}
          zoneId={zoneId}
          isEditMode
          onTablePositionChange={(id, x, y) => {
            if (isBusy) return;
            setIsDirty(true);
            updateTablePosition(id, x, y);
          }}
          onOpenTable={() => undefined}
          onInspectTable={() => undefined}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button disabled={isBusy} onClick={close}>Vazgeç</Button>
        <Button variant="primary" disabled={!isDirty} isLoading={isBusy} onClick={() => void save()}>Kaydet</Button>
      </div>
    </Modal>
  );
};
