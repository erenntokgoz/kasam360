import React, { useState } from 'react';
import { useFloorStore } from '../../../stores/floorStore';
import { useUIStore } from '../../../stores/uiStore';
import type { FloorObject, FloorObjectKind } from '../../../types/floor';
import { Bar, BarTab } from '../../../ui/Bar';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { ErrorToast } from '../../../ui/ErrorToast';
import { Modal } from '../../../ui/Modal';
import { TABLE_SIZE, materializeAutoPlacement } from '../../../lib/krokiLayout';
import { clampToCanvas } from '../../../lib/krokiGeometry';
import { getBlueprintZoneId, getFloorObjectWidth } from '../../floor/blueprintView';
import { FloorBlueprint } from '../../floor/FloorBlueprint';

/** Düzenlemeler modal içinde taslak kalır; tek kayıtta seçili olmayan kısımlar da korunur. */
export const KrokiEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { zones, tables, objects, selectedZoneId, floorError, saveFloorLayout, setKrokiEditMode } = useFloorStore();
  const [zoneSelection, setZoneSelection] = useState<string | null>(() => selectedZoneId ?? zones[0]?.id ?? null);
  const zoneId = getBlueprintZoneId(zoneSelection, zones);
  // Yerleşmemiş masaların ekranda görünen yeri açılışta taslağa yazılır: ilk sürüklemeden sonra
  // dizilim değişip masalar sıçramaz ve salon ekranıyla aynı konumdan başlanır.
  const [initial] = useState(() => materializeAutoPlacement(zones, tables));
  const [draftTables, setDraftTables] = useState(initial.tables);
  const [draftObjects, setDraftObjects] = useState(objects);
  const [movedTableIds, setMovedTableIds] = useState<Set<string>>(() => new Set(initial.placedIds));
  const [changedObjectIds, setChangedObjectIds] = useState<Set<string>>(() => new Set());
  const [deletedObjectIds, setDeletedObjectIds] = useState<string[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const close = () => {
    if (isBusy) return;
    if (isDirty) setShowDiscardConfirm(true);
    else onClose();
  };

  const addObject = (kind: Extract<FloorObjectKind, 'DOOR' | 'WINDOW'>) => {
    if (!zoneId) return;
    const label = kind === 'DOOR' ? 'Kapı' : 'Pencere';
    const sameZone = draftObjects.filter((object) => object.zoneId === zoneId);
    const rightEdge = Math.max(40, ...draftTables.filter((table) => table.zoneId === zoneId).map((table) => table.posX + table.width + 30));
    const object: FloorObject = {
      id: `draft:${crypto.randomUUID()}`,
      zoneId,
      kind,
      label,
      x: rightEdge,
      y: 80 + sameZone.length * 36,
      width: getFloorObjectWidth(label),
      height: 24,
      rotation: 0,
      isActive: true,
    };
    setDraftObjects((current) => [...current, object]);
    setSelectedObjectId(object.id);
    setIsDirty(true);
  };

  const updateObject = (objectId: string, update: Partial<FloorObject>) => {
    setDraftObjects((current) => current.map((object) => object.id === objectId ? { ...object, ...update } : object));
    if (!objectId.startsWith('draft:')) setChangedObjectIds((current) => new Set(current).add(objectId));
    setIsDirty(true);
  };

  const removeSelectedObject = () => {
    if (!selectedObjectId) return;
    const removed = draftObjects.find((object) => object.id === selectedObjectId);
    const removedId = selectedObjectId;
    // Taslak içinde kalan bir silme; kayda basılana kadar geri alınabilir, veri kaybı olmaz.
    if (removed) {
      useUIStore.getState().pushUndoNotice('Öğe taslaktan kaldırıldı.', {
        label: 'Geri al',
        run: () => {
          setDraftObjects((current) => (current.some((object) => object.id === removedId) ? current : [...current, removed]));
          setDeletedObjectIds((current) => current.filter((id) => id !== removedId));
          setSelectedObjectId(removedId);
        },
      });
    }
    setDraftObjects((current) => current.filter((object) => object.id !== selectedObjectId));
    setChangedObjectIds((current) => { const next = new Set(current); next.delete(selectedObjectId); return next; });
    if (!selectedObjectId.startsWith('draft:')) setDeletedObjectIds((current) => [...current, selectedObjectId]);
    setSelectedObjectId(null);
    setIsDirty(true);
  };

  const save = async () => {
    if (isBusy) return;
    setIsBusy(true);
    const saved = await saveFloorLayout({
      tables: draftTables.filter((table) => movedTableIds.has(table.id)),
      objects: draftObjects.filter((object) => changedObjectIds.has(object.id)),
      newObjects: draftObjects.filter((object) => object.id.startsWith('draft:')),
      deletedObjectIds,
    });
    setKrokiEditMode(true);
    setIsBusy(false);
    if (saved) onClose();
  };

  const selectedObject = draftObjects.find((object) => object.id === selectedObjectId);

  return (
    <>
      <Modal cardFlow fullScreen isOpen title="Krokiyi Düzenle" onClose={close}>
        <div className="flex-1 min-h-0 flex flex-col">
          {zones.length > 0 ? (
            <Bar label="Düzenlenecek kısım">
              {zones.map((zone) => (
                <BarTab key={zone.id} active={zoneId === zone.id} onClick={() => { setZoneSelection(zone.id); setSelectedObjectId(null); }}>
                  {zone.name}
                </BarTab>
              ))}
            </Bar>
          ) : <p className="px-4 py-3 text-sm text-[var(--text-secondary)]">Önce bir kısım ekleyin.</p>}

          <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
            <Button size="sm" disabled={!zoneId || isBusy} onClick={() => addObject('DOOR')}>+ Kapı</Button>
            <Button size="sm" disabled={!zoneId || isBusy} onClick={() => addObject('WINDOW')}>+ Pencere</Button>
            {selectedObject ? (
              <>
                <label className="ml-2 flex items-center gap-2 text-sm">
                  <span>Etiket</span>
                  <input
                    aria-label="Seçili öğe etiketi"
                    value={selectedObject.label ?? ''}
                    disabled={isBusy}
                    onChange={(event) => {
                      const label = event.target.value;
                      updateObject(selectedObject.id, { label, width: getFloorObjectWidth(label) });
                    }}
                    className="h-9 min-w-48 rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
                  />
                </label>
                <Button size="sm" variant="danger" disabled={isBusy} onClick={removeSelectedObject}>Öğeyi kaldır</Button>
              </>
            ) : null}
          </div>

          <ErrorToast message={floorError} />
          {zoneId ? (
            <FloorBlueprint
              zones={zones}
              tables={draftTables}
              objects={draftObjects}
              zoneId={zoneId}
              isEditMode
              selectedObjectId={selectedObjectId}
              onSelectObject={setSelectedObjectId}
              onTablePositionChange={(id, x, y) => {
                if (isBusy) return;
                setDraftTables((current) => current.map((table) => table.id === id ? { ...table, posX: x, posY: y } : table));
                setMovedTableIds((current) => new Set(current).add(id));
                setIsDirty(true);
              }}
              onTableRotate={(id, rotation) => {
                if (isBusy) return;
                // Dönen masanın köşeleri tuval dışına çıkmasın diye konum aynı adımda düzeltilir.
                setDraftTables((current) => current.map((table) => {
                  if (table.id !== id) return table;
                  const position = clampToCanvas({ x: table.posX, y: table.posY }, { width: TABLE_SIZE, height: TABLE_SIZE }, rotation);
                  return { ...table, rotation, posX: Math.round(position.x), posY: Math.round(position.y) };
                }));
                setMovedTableIds((current) => new Set(current).add(id));
                setIsDirty(true);
              }}
              onObjectPositionChange={(id, x, y) => updateObject(id, { x, y })}
              onObjectRotate={(id, rotation) => updateObject(id, { rotation })}
              onOpenTable={() => undefined}
              onInspectTable={() => undefined}
            />
          ) : <div className="flex-1" />}

          <div className="shrink-0 flex justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
            <Button disabled={isBusy} onClick={close}>Vazgeç</Button>
            <Button variant="primary" disabled={!isDirty || isBusy} isLoading={isBusy} onClick={() => void save()}>Kaydet</Button>
          </div>
        </div>
      </Modal>
      {showDiscardConfirm ? (
        <ConfirmDialog
          title="Kaydedilmemiş kroki değişiklikleri"
          message="Değişiklikleri kaydetmeden kapatırsanız son düzenlemeler silinir."
          confirmLabel="Değişiklikleri at"
          cardFlow
          onConfirm={async () => { setShowDiscardConfirm(false); onClose(); }}
          onClose={() => setShowDiscardConfirm(false)}
        />
      ) : null}
    </>
  );
};
