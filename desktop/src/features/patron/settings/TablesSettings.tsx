import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useEffect, useState } from 'react';
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
import { RecordCard } from '../RecordCard';

export const TablesSettings: React.FC = () => {
  const { zones, tables, floorError, addZone, renameZone, removeZone, updateTable, removeTable, loadFloorPlan, setKrokiEditMode } = useFloorStore();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [editingZone, setEditingZone] = useState<FloorZone | null>(null);
  const [deletingZone, setDeletingZone] = useState<FloorZone | null>(null);
  const [isZoneOpen, setIsZoneOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState(false);
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
  const selectedTable = tables.find((table) => table.id === selectedTableId);
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
    if (isBusy) return;
    setError(null);
    setIsZoneOpen(false);
    setEditingZone(null);
    setZoneName('');
  };

  const saveZone = () =>
    run(async () => {
      const trimmed = zoneName.trim();
      if (editingZone) await renameZone(editingZone.id, trimmed);
      else setZoneId(await addZone(trimmed));
      setIsZoneOpen(false);
      setEditingZone(null);
      setZoneName('');
    });

  const saveTableName = () =>
    run(async () => {
      if (selectedTable) await updateTable(selectedTable.id, tableName.trim(), seatCount);
      setEditingTable(false);
    });

  return (
    <div className="space-y-4">
      {floorError ? <ErrorToast message={floorError} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="print-title">Kısımlar</h3>
            <Button variant="primary" onClick={() => { setError(null); setIsZoneOpen(true); }}>Kısım Ekle</Button>
          </div>
          {zones.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Henüz kısım yok.</p> : null}
          <ul className="grid gap-2">
            {zones.map((zone) => (
              <li key={zone.id}>
                <Button type="button" aria-pressed={zone.id === activeZone?.id}
                  variant={zone.id === activeZone?.id ? 'selected' : 'secondary'}
                  className="w-full min-w-0 !justify-between !text-left" onClick={() => setZoneId(zone.id)}>
                  <span className="min-w-0 truncate">{zone.name}</span>
                  <span className="shrink-0 tabular-nums">{zone.tableCount} masa</span>
                </Button>
              </li>
            ))}
          </ul>
          {activeZone ? (
            <Button onClick={() => {
              setError(null);
              setEditingZone(activeZone);
              setZoneName(activeZone.name);
              setIsZoneOpen(true);
            }}>Seçili Kısmı Düzenle</Button>
          ) : null}
          {isZoneOpen ? (
            <Modal cardFlow isOpen onClose={closeZone} title={editingZone?.name ?? 'Kısım Ekle'} maxWidth="sm">
              <form className="space-y-3" onSubmit={(event) => {
                event.preventDefault();
                if (zoneName.trim() && !isBusy) void saveZone();
              }}>
                <label className="block space-y-1 text-sm font-semibold">
                  <span>Kısım adı</span>
                  <Input value={zoneName} maxLength={40} onChange={(event) => setZoneName(event.target.value)} required />
                </label>
                {error ? <ErrorToast message={error} /> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  {editingZone && activeZone?.id === editingZone.id ? (
                    <Button type="button" variant="ghost" className="mr-auto" disabled={isBusy || activeZone.tableCount > 0}
                      onClick={() => { setDeletingZone(activeZone); closeZone(); }}>Kısmı Sil</Button>
                  ) : null}
                  <Button type="button" disabled={isBusy} onClick={closeZone}>Vazgeç</Button>
                  <Button type="submit" variant="primary" disabled={!zoneName.trim()} isLoading={isBusy}>Kaydet</Button>
                </div>
              </form>
            </Modal>
          ) : null}
        </section>

        <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="print-title">{activeZone?.name ?? 'Masalar'}</h3>
            <Button variant="primary" className="min-h-12" disabled={!activeZone} onClick={() => setIsAdding(true)}>
              Masa Ekle
            </Button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {zoneTables.map((table) => (
              <li key={table.id}>
                <RecordCard title={table.tableNumber} description={`${table.capacity} kişi`} onOpen={() => {
                  setError(null);
                  setSelectedTableId(table.id);
                }} />
              </li>
            ))}
          </ul>
          {!activeZone ? <p className="text-sm text-[var(--text-secondary)]">Masa eklemek için önce kısım ekleyin.</p> : null}
          {activeZone && zoneTables.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Bu kısımda masa yok.</p> : null}
        </section>
      </div>

      {tables.length > 0 ? (
        <Button variant="primary" className="w-full min-h-12" onClick={() => setIsKrokiOpen(true)}>
          Krokiyi Düzenle
        </Button>
      ) : null}
      {isKrokiOpen ? <KrokiEditor onClose={() => setIsKrokiOpen(false)} /> : null}

      {isAdding && activeZone ? <AddTablesModal zones={zones} initialZoneId={activeZone.id} onClose={() => setIsAdding(false)} /> : null}
      {selectedTable && !deleting ? (
        <Modal cardFlow isOpen onClose={() => {
          if (!isBusy) { setSelectedTableId(null); setEditingTable(false); setError(null); }
        }} title={selectedTable.tableNumber} subtitle={activeZone?.name} maxWidth="sm">
          {editingTable ? (
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              if (tableName.trim() && isSeatCountValid && !isBusy) void saveTableName();
            }}>
              <label className="block space-y-1 text-sm font-semibold">
                <span>Masa adı</span>
                <Input value={tableName} maxLength={40} onChange={(event) => setTableName(event.target.value)} required />
              </label>
              <label className="block space-y-1 text-sm font-semibold">
                <span>Kişi</span>
                <NumberInput kind="integer" pinpad={false} value={tableSeats} onValueChange={setTableSeats} />
              </label>
              {error ? <ErrorToast message={error} /> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" disabled={isBusy} onClick={() => { setEditingTable(false); setError(null); }}>Vazgeç</Button>
                <Button type="submit" variant="primary" disabled={!tableName.trim() || !isSeatCountValid} isLoading={isBusy}>Kaydet</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm tabular-nums">Kapasite: {selectedTable.capacity} kişi</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={selectedTable.status !== 'EMPTY'} onClick={() => setDeleting(selectedTable)}>Masayı Sil</Button>
                <Button variant="primary" onClick={() => {
                  setTableName(selectedTable.tableNumber);
                  setTableSeats(String(selectedTable.capacity));
                  setEditingTable(true);
                }}>Düzenle</Button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}
      {deleting ? <ConfirmDialog cardFlow title={`${deleting.tableNumber} silinsin mi?`} onConfirm={async () => {
        await removeTable(deleting.id);
        setSelectedTableId(null);
      }} onClose={() => setDeleting(null)} /> : null}
      {deletingZone ? <ConfirmDialog cardFlow title={`${deletingZone.name} silinsin mi?`} onConfirm={() => removeZone(deletingZone.id)} onClose={() => setDeletingZone(null)} /> : null}
    </div>
  );
};
