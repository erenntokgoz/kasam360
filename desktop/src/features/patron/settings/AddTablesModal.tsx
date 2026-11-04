import React, { useMemo, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { BATCH_LIMIT, buildTableBatch, findDuplicateName, nextTableNumber, type TableGroup } from '../../../lib/tableBatch';
import { useFloorStore } from '../../../stores/floorStore';
import type { FloorZone } from '../../../types/floor';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Modal } from '../../../ui/Modal';
import { NumberInput } from '../../../ui/NumberInput';
import { TableOutline } from '../../floor/TableOutline';

const labelClass = 'block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]';

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}

const Stepper: React.FC<StepperProps> = ({ label, value, min, max, onChange }) => {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div className="min-w-0">
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="secondary" className="min-h-12 w-12 shrink-0 !px-0" aria-label={`${label} azalt`} disabled={value <= min} onClick={() => set(value - 1)}>
          <Minus className="w-5 h-5" />
        </Button>
        <NumberInput aria-label={label} kind="integer" pinpad={false} className="text-center" value={String(value)} onValueChange={(raw) => set(Number.parseInt(raw, 10) || min)} />
        <Button type="button" variant="secondary" className="min-h-12 w-12 shrink-0 !px-0" aria-label={`${label} artır`} disabled={value >= max} onClick={() => set(value + 1)}>
          <Plus className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

interface AddTablesModalProps {
  zones: FloorZone[];
  initialZoneId: string;
  onClose: () => void;
}

export const AddTablesModal: React.FC<AddTablesModalProps> = ({ zones, initialZoneId, onClose }) => {
  const { tables, addTables } = useFloorStore();
  const existingNames = useMemo(() => tables.map((table) => table.tableNumber), [tables]);
  const [zoneId, setZoneId] = useState(initialZoneId);
  const [name, setName] = useState('Masa');
  const [startOverride, setStartOverride] = useState<string | null>(null);
  const [groups, setGroups] = useState<TableGroup[]>([{ count: 5, seats: 4 }]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const start = startOverride === null ? nextTableNumber(existingNames, name) : Number.parseInt(startOverride, 10) || 1;
  const batch = useMemo(() => buildTableBatch(name, start, groups), [name, start, groups]);
  const duplicate = findDuplicateName(batch, existingNames);
  const isTooMany = batch.length > BATCH_LIMIT;

  const updateGroup = (index: number, patch: Partial<TableGroup>) => setGroups((current) => current.map((group, position) => (position === index ? { ...group, ...patch } : group)));

  const save = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await addTables(batch, zoneId);
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Masa Ekle" maxWidth="5xl">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <div>
            <span className={labelClass}>Kısım</span>
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <Button key={zone.id} type="button" variant={zone.id === zoneId ? 'primary' : 'secondary'} className="min-h-12" aria-pressed={zone.id === zoneId} onClick={() => setZoneId(zone.id)}>
                  {zone.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
            <div>
              <label htmlFor="batch-name" className={labelClass}>Masa adı</label>
              <Input id="batch-name" className="min-h-12" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label htmlFor="batch-start" className={labelClass}>Başlangıç no</label>
              <NumberInput id="batch-start" kind="integer" pinpad={false} value={String(start)} onValueChange={setStartOverride} />
            </div>
          </div>

          <div className="space-y-2">
            {groups.map((group, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem] items-end gap-2">
                <Stepper label="Adet" value={group.count} min={1} max={BATCH_LIMIT} onChange={(count) => updateGroup(index, { count })} />
                <Stepper label="Kişi" value={group.seats} min={1} max={30} onChange={(seats) => updateGroup(index, { seats })} />
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12 !px-0"
                  aria-label="Grubu kaldır"
                  disabled={groups.length === 1}
                  onClick={() => setGroups((current) => current.filter((_, position) => position !== index))}
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" className="w-full min-h-12" onClick={() => setGroups((current) => [...current, { count: 1, seats: current[current.length - 1].seats }])}>
              Farklı Kişi Sayısı Ekle
            </Button>
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 className="print-title">{zones.find((zone) => zone.id === zoneId)?.name}</h3>
            <span className="font-bold tabular-nums">{batch.length} masa</span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 content-start h-80 overflow-y-auto pr-1">
            {batch.map((table) => (
              <li key={table.name} className="relative h-24 flex items-center justify-center text-[var(--ink)]">
                <span className="absolute inset-0">
                  <TableOutline seats={table.seats} />
                </span>
                <span className="relative hand text-sm font-bold truncate max-w-[70%]">{table.name}</span>
                <span className="absolute right-1 top-0 text-sm font-bold tabular-nums">{table.seats}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {duplicate ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--accent-red)]">{duplicate} zaten var.</p> : null}
      {isTooMany ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--accent-red)]">Tek seferde en fazla {BATCH_LIMIT} masa eklenir.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--accent-red)]">{error}</p> : null}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={onClose}>Vazgeç</Button>
        <Button type="button" variant="primary" className="min-h-12" disabled={!name.trim() || !zoneId || Boolean(duplicate) || isTooMany} isLoading={isBusy} onClick={() => void save()}>
          {batch.length} Masa Ekle
        </Button>
      </div>
    </Modal>
  );
};
