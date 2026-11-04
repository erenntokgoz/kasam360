import React, { useEffect, useState } from 'react';
import { useFloorStore } from '../../../stores/floorStore';
import { Bar, BarAction, BarTab } from '../../../ui/Bar';
import { FloorBlueprint } from '../../floor/FloorBlueprint';

/** Kroki tam ekranda düzenlenir; kanvas büyüdükçe ölçek küçülür, sayfa kaydırılmaz. */
export const KrokiEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { zones, tables, loadFloorPlan, updateTablePosition, saveFloorLayout, setKrokiEditMode } = useFloorStore();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const close = () => {
    // Kaydedilmeyen sürüklemeler atılır: ekranda kayıttaki düzen kalır.
    if (isDirty) void loadFloorPlan();
    onClose();
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const save = async () => {
    setIsBusy(true);
    const saved = await saveFloorLayout();
    setKrokiEditMode(true);
    setIsBusy(false);
    if (saved) onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Kroki düzenleme" className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-canvas)]">
      <Bar
        label="Kısımlar"
        actions={
          <>
            <BarAction onClick={close}>Vazgeç</BarAction>
            <BarAction tone="primary" disabled={isBusy} onClick={() => void save()}>Kaydet</BarAction>
          </>
        }
      >
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
          setIsDirty(true);
          updateTablePosition(id, x, y);
        }}
        onOpenTable={() => undefined}
        onInspectTable={() => undefined}
      />
    </div>
  );
};
