import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { useFloorStore } from '../../stores/floorStore';
import type { FloorTable } from '../../types/floor';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';

/** Masa ekleme, adını değiştirme ve silme tek pencerede. Dolu masa silinmez. */
export const TableManagerModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { tables, addTable, renameTable, removeTable } = useFloorStore();
  const [name, setName] = useState('');
  const [zone, setZone] = useState('Salon');
  const [seats, setSeats] = useState('4');
  const [editing, setEditing] = useState<FloorTable | null>(null);
  const [deleting, setDeleting] = useState<FloorTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const resetForm = () => {
    setEditing(null);
    setName('');
  };

  const save = async () => {
    setIsBusy(true);
    setError(null);
    try {
      if (editing) await renameTable(editing.id, name.trim());
      else await addTable(name.trim(), zone.trim(), Number.parseInt(seats, 10) || 1);
      resetForm();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Masalar" maxWidth="3xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h3 className="print-title text-sm font-bold">{editing ? `${editing.tableNumber} Düzenle` : 'Yeni Masa'}</h3>
          <div>
            <label htmlFor="table-name" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">Masa Adı</label>
            <Input id="table-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {editing ? null : (
            <>
              <div>
                <label htmlFor="table-zone" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">Bölüm</label>
                <Input id="table-zone" value={zone} maxLength={40} onChange={(e) => setZone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="table-seats" className="block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]">Kişi Sayısı</label>
                <NumberInput id="table-seats" kind="integer" value={seats} onValueChange={setSeats} />
              </div>
            </>
          )}
          {error ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}
          <div className="flex gap-2">
            {editing ? <Button variant="secondary" className="flex-1" onClick={resetForm}>Vazgeç</Button> : null}
            <Button variant="primary" className="flex-1" disabled={!name.trim() || !zone.trim()} isLoading={isBusy} onClick={() => void save()}>
              Kaydet
            </Button>
          </div>
        </div>

        <ul className="divide-y divide-[var(--border)] max-h-[26rem] overflow-y-auto pr-1">
          {tables.map((table) => (
            <li key={table.id} className="flex items-center gap-1.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold truncate">{table.tableNumber}</span>
                <span className="block text-sm text-[var(--text-secondary)]">{table.zoneName} · {table.capacity} kişilik</span>
              </span>
              <Button
                variant="ghost"
                aria-label={`${table.tableNumber} düzenle`}
                onClick={() => {
                  setEditing(table);
                  setName(table.tableNumber);
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
      </div>
      {deleting ? (
        <ConfirmDialog title={`${deleting.tableNumber} silinsin mi?`} onConfirm={() => removeTable(deleting.id)} onClose={() => setDeleting(null)} />
      ) : null}
    </Modal>
  );
};
