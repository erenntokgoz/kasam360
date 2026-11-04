import React, { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { useFloorStore } from '../../../stores/floorStore';
import type { FloorTable, FloorZone } from '../../../types/floor';
import { Button } from '../../../ui/Button';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { NumberInput } from '../../../ui/NumberInput';
import { AddTablesModal } from './AddTablesModal';
import { KrokiEditor } from './KrokiEditor';

export const TablesSettings: React.FC = () => {
  const { zones, tables, addZone, renameZone, removeZone, updateTable, removeTable, loadFloorPlan, setKrokiEditMode } = useFloorStore();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [editingZone, setEditingZone] = useState<FloorZone | null>(null);
  const [deletingZone, setDeletingZone] = useState<FloorZone | null>(null);
  const [isZoneOpen, setIsZoneOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<FloorTable | null>(null);
  const [tableName, setTableName] = useState('');
  const [tableSeats, setTableSeats] = useState('');
  const [deleting, setDeleting] = useState<FloorTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isKrokiOpen, setIsKrokiOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // Bu ekran açıkken salon yenilemesi durur: sürüklenen masa eski yerine atlamaz.
  useEffect(() => {
    setKrokiEditMode(true);
    void loadFloorPlan();
    return () => setKrokiEditMode(false);
  }, [loadFloorPlan, setKrokiEditMode]);

  const activeZone = zones.find((zone) => zone.id === zoneId) ?? zones[0] ?? null;
  const zoneTables = tables.filter((table) => table.zoneId === activeZone?.id);
  const seatCount = Number.parseInt(tableSeats, 10);
  const isSeatCountValid = seatCount >= 1 && seatCount <= 30;

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  const closeZone = () => {
    setIsZoneOpen(false);
    setEditingZone(null);
    setZoneName('');
  };

  const saveZone = () =>
    run(async () => {
      const trimmed = zoneName.trim();
      if (editingZone) await renameZone(editingZone.id, trimmed);
      else setZoneId(await addZone(trimmed));
      closeZone();
    });

  const saveTableName = () =>
    run(async () => {
      if (editing) await updateTable(editing.id, tableName.trim(), Number.parseInt(tableSeats, 10));
      setEditing(null);
    });

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <h3 className="print-title">Kısımlar</h3>
          <Button variant="primary" className="w-full min-h-12" onClick={() => setIsZoneOpen(true)}>Kısım Ekle</Button>
          {isZoneOpen ? (
            <Modal isOpen onClose={closeZone} title={editingZone ? 'Kısmı Düzenle' : 'Kısım Ekle'} maxWidth="sm">
              <div className="space-y-3">
                <Input aria-label="Kısım adı" placeholder="Kısım adı" className="min-h-12" value={zoneName} maxLength={40} autoFocus onChange={(event) => setZoneName(event.target.value)} />
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1 min-h-12" onClick={closeZone}>Vazgeç</Button>
                  <Button variant="primary" className="flex-1 min-h-12" disabled={!zoneName.trim()} isLoading={isBusy} onClick={() => void saveZone()}>Kaydet</Button>
                </div>
              </div>
            </Modal>
          ) : null}
          <ul className="divide-y divide-[var(--border)] max-h-[22rem] overflow-y-auto">
            {zones.map((zone) => (
              <li key={zone.id} className="flex items-center gap-1 py-1">
                <button
                  type="button"
                  aria-pressed={zone.id === activeZone?.id}
                  className={`flex-1 min-w-0 min-h-12 px-2 rounded text-left font-semibold truncate ${zone.id === activeZone?.id ? 'bg-[var(--marker)]' : ''}`}
                  onClick={() => setZoneId(zone.id)}
                >
                  {zone.name} <span className="tabular-nums font-normal">{zone.tableCount}</span>
                </button>
                <Button
                  variant="ghost"
                  aria-label={`${zone.name} düzenle`}
                  onClick={() => {
                    setEditingZone(zone);
                    setZoneName(zone.name);
                    setIsZoneOpen(true);
                  }}
                >
                  <Pencil className="w-5 h-5" />
                </Button>
                <Button variant="ghost" aria-label={`${zone.name} sil`} disabled={zone.tableCount > 0} onClick={() => setDeletingZone(zone)}>
                  <Trash2 className="w-5 h-5" />
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="print-title">{activeZone?.name ?? 'Masalar'}</h3>
            <Button variant="primary" className="min-h-12" disabled={!activeZone} onClick={() => setIsAdding(true)}>
              Masa Ekle
            </Button>
          </div>
          <ul className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3 max-h-[22rem] overflow-y-auto pr-1">
            {zoneTables.map((table) => (
              <li key={table.id} className="flex items-center gap-1 border-b border-[var(--border)] py-1">
                <span className="min-w-0 flex-1 font-bold truncate">{table.tableNumber}</span>
                <span className="text-sm tabular-nums text-[var(--text-secondary)]">{table.capacity} kişi</span>
                <Button
                  variant="ghost"
                  aria-label={`${table.tableNumber} düzenle`}
                  onClick={() => {
                    setEditing(table);
                    setTableName(table.tableNumber);
                    setTableSeats(String(table.capacity));
                  }}
                >
                  <Pencil className="w-5 h-5" />
                </Button>
                <Button variant="ghost" aria-label={`${table.tableNumber} sil`} disabled={table.status !== 'EMPTY'} onClick={() => setDeleting(table)}>
                  <Trash2 className="w-5 h-5" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {tables.length > 0 ? (
        <Button variant="primary" className="w-full min-h-12" onClick={() => setIsKrokiOpen(true)}>
          Krokiyi Düzenle
        </Button>
      ) : null}
      {isKrokiOpen ? <KrokiEditor onClose={() => setIsKrokiOpen(false)} /> : null}

      {isAdding && activeZone ? <AddTablesModal zones={zones} initialZoneId={activeZone.id} onClose={() => setIsAdding(false)} /> : null}
      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title="Masayı Düzenle" maxWidth="sm">
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            Masa adı
            <Input className="min-h-12 mt-1" value={tableName} maxLength={40} autoFocus onChange={(event) => setTableName(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            Kişi
            <NumberInput kind="integer" pinpad={false} className="mt-1" value={tableSeats} onValueChange={setTableSeats} />
          </label>
          <Button variant="primary" className="w-full min-h-12" disabled={!tableName.trim() || !isSeatCountValid} isLoading={isBusy} onClick={() => void saveTableName()}>
            Kaydet
          </Button>
        </div>
      </Modal>
      {deleting ? <ConfirmDialog title={`${deleting.tableNumber} silinsin mi?`} onConfirm={() => removeTable(deleting.id)} onClose={() => setDeleting(null)} /> : null}
      {deletingZone ? <ConfirmDialog title={`${deletingZone.name} silinsin mi?`} onConfirm={() => removeZone(deletingZone.id)} onClose={() => setDeletingZone(null)} /> : null}
    </div>
  );
};
