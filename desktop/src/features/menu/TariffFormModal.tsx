import { capitalizeRecordName } from '../../lib/recordName';
import React, { useState } from 'react';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';

export interface TariffSchedule {
  enabled: boolean;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[];
  validFrom: string | null;
  validTo: string | null;
}

export interface Tariff {
  id: string;
  name: string;
  percent: number;
  productIds: string[];
  isActive: boolean;
  schedule: TariffSchedule | null;
}

export interface TariffDraft {
  id: string | null;
  name: string;
  percent: number;
  productIds: string[] | null;
  schedule: TariffSchedule | null;
}

interface TariffFormModalProps {
  tariff: Tariff | null;
  products: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TariffDraft) => void;
}

export const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const field = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';

export const TariffFormModal: React.FC<TariffFormModalProps> = ({ tariff, products, busy, onClose, onSave }) => {
  const schedule = tariff?.schedule;
  const [name, setName] = useState(tariff?.name ?? '');
  const [direction, setDirection] = useState<'UP' | 'DOWN'>(tariff && tariff.percent < 0 ? 'DOWN' : 'UP');
  const [percent, setPercent] = useState(tariff ? String(Math.abs(tariff.percent)) : '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '');
  const [endTime, setEndTime] = useState(schedule?.endTime ?? '');
  const [days, setDays] = useState<number[]>(schedule?.daysOfWeek ?? []);
  const [validFrom, setValidFrom] = useState(schedule?.validFrom ?? '');
  const [validTo, setValidTo] = useState(schedule?.validTo ?? '');
  const [isScheduled, setIsScheduled] = useState(Boolean(schedule));
  const [selected, setSelected] = useState<string[]>(tariff?.productIds ?? []);
  const [onlySelected, setOnlySelected] = useState((tariff?.productIds.length ?? 0) > 0);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const value = Number(percent);
    if (!name.trim() || !Number.isInteger(value) || value <= 0) {
      setError('Tarife adı ve yüzde girin.');
      return;
    }
    if (isScheduled && Boolean(startTime) !== Boolean(endTime)) {
      setError('Başlangıç ve bitiş saatini birlikte girin.');
      return;
    }
    if (onlySelected && selected.length === 0) {
      setError('En az bir ürün seçin.');
      return;
    }
    if (isScheduled && !(startTime || validFrom || validTo || days.length)) {
      setError('Takvim için saat, gün veya tarih girin.');
      return;
    }
    onSave({
      id: tariff?.id ?? null,
      name: name.trim(),
      percent: direction === 'UP' ? value : -value,
      productIds: onlySelected ? selected : null,
      // Yeni takvim kapalı başlar: tarife listede Aç düğmesiyle devreye girer.
      schedule: isScheduled
        ? {
            enabled: schedule?.enabled ?? false,
            startTime: startTime || null,
            endTime: endTime || null,
            daysOfWeek: days,
            validFrom: validFrom || null,
            validTo: validTo || null,
          }
        : null,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={tariff ? 'Tarifeyi Düzenle' : 'Tarife Ekle'} maxWidth="md">
      <div className="space-y-3">
        <Input aria-label="Tarife adı" placeholder="Tarife adı" className="min-h-12" value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))} onChange={(event) => setName(event.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Zam veya indirim" className={field} value={direction} onChange={(event) => setDirection(event.target.value as 'UP' | 'DOWN')}>
            <option value="UP">Zam</option>
            <option value="DOWN">İndirim</option>
          </select>
          <NumberInput kind="integer" aria-label="Yüzde" placeholder="Yüzde" className="min-h-12" value={percent} onValueChange={setPercent} />
        </div>
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={isScheduled} onChange={(event) => setIsScheduled(event.target.checked)} />
          <span>Takvime bağla</span>
        </label>
        {isScheduled ? (
        <>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold">Başlangıç saati<Input type="time" className="min-h-12" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label className="text-xs font-semibold">Bitiş saati<Input type="time" className="min-h-12" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          <label className="text-xs font-semibold">Başlangıç tarihi<Input type="date" className="min-h-12" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
          <label className="text-xs font-semibold">Bitiş tarihi<Input type="date" className="min-h-12" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></label>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAY_LABELS.map((label, index) => {
            const day = index + 1;
            const isOn = days.includes(day);
            return (
              <Button
                key={label}
                variant={isOn ? 'primary' : 'secondary'}
                className="min-h-12 !px-0"
                aria-pressed={isOn}
                onClick={() => setDays((current) => (isOn ? current.filter((item) => item !== day) : [...current, day].sort()))}
              >
                {label}
              </Button>
            );
          })}
        </div>
        </>
        ) : null}
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)} />
          <span>Yalnız seçilen ürünlere uygula</span>
        </label>
        {onlySelected ? (
          <div className="grid gap-1 sm:grid-cols-2 max-h-48 overflow-y-auto">
            {products.map((product) => (
              <label key={product.id} className="flex min-h-12 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(product.id)}
                  onChange={(event) =>
                    setSelected((current) => (event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id)))
                  }
                />
                <span className="truncate">{product.name}</span>
              </label>
            ))}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 min-h-12" onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" className="flex-1 min-h-12" disabled={busy} onClick={save}>Kaydet</Button>
        </div>
      </div>
    </Modal>
  );
};
