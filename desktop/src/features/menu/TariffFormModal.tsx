import { capitalizeRecordName } from '../../lib/recordName';
import { localDate } from '../../lib/cariInput';
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

const section = 'space-y-3 border-t border-[var(--border)] pt-4';
const label = 'block space-y-1 text-sm font-medium';
const optionGrid = 'grid grid-cols-2 gap-2';

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
  const [hasDates, setHasDates] = useState(Boolean(schedule?.validFrom || schedule?.validTo));
  const [selected, setSelected] = useState<string[]>(tariff?.productIds ?? []);
  const [onlySelected, setOnlySelected] = useState((tariff?.productIds.length ?? 0) > 0);
  const [error, setError] = useState<string | null>(null);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const savedName = capitalizeRecordName(name.trim());
    const value = Number(percent);
    const maxPercent = direction === 'UP' ? 200 : 90;
    const dateFrom = hasDates ? validFrom : '';
    const dateTo = hasDates ? validTo : '';
    if (!savedName || !Number.isInteger(value) || value < 1 || value > maxPercent) {
      setError(`Tarife adı ve %1–%${maxPercent} arasında bir oran girin.`);
      return;
    }
    if (onlySelected && selected.length === 0) {
      setError('En az bir ürün seçin.');
      return;
    }
    if (isScheduled) {
      if (Boolean(startTime) !== Boolean(endTime) || (startTime && startTime === endTime)) {
        setError('Başlangıç ve bitiş saatlerini birlikte ve farklı girin.');
        return;
      }
      if (dateFrom && dateTo && dateTo < dateFrom) {
        setError('Bitiş tarihi başlangıçtan önce olamaz.');
        return;
      }
      if (!(startTime || dateFrom || dateTo || days.length)) {
        setError('Rutin için gün, saat veya tarih aralığı seçin.');
        return;
      }
    }
    setError(null);
    onSave({
      id: tariff?.id ?? null,
      name: savedName,
      percent: direction === 'UP' ? value : -value,
      productIds: onlySelected ? selected : null,
      // Kaydetme fiyatı devreye almaz. Rutin, listedeki Aç işlemiyle etkinleşir.
      schedule: isScheduled ? {
        enabled: schedule?.enabled ?? false,
        startTime: startTime || null,
        endTime: endTime || null,
        daysOfWeek: days,
        validFrom: dateFrom || null,
        validTo: dateTo || null,
      } : null,
    });
  };

  return (
    <Modal cardFlow isOpen onClose={() => { if (!busy) onClose(); }} title={tariff ? 'Tarifeyi Düzenle' : 'Tarife Ekle'} maxWidth="md">
      <form className="space-y-4" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-4">
          <label className={label}>Tarife adı
            <Input maxLength={120} value={name} onBlur={(event) => setName(capitalizeRecordName(event.currentTarget.value))}
              onChange={(event) => setName(event.target.value)} />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-1">
              <p className="text-sm font-medium">Fiyat Değişikliği</p>
              <div className={optionGrid} role="group" aria-label="Fiyat değişikliği">
                <Button type="button" variant={direction === 'UP' ? 'selected' : 'secondary'}
                  aria-pressed={direction === 'UP'} onClick={() => setDirection('UP')}>Zam</Button>
                <Button type="button" variant={direction === 'DOWN' ? 'selected' : 'secondary'}
                  aria-pressed={direction === 'DOWN'} onClick={() => setDirection('DOWN')}>İndirim</Button>
              </div>
            </div>
            <label className={label}>Oran (%)
              <NumberInput kind="integer" value={percent} onValueChange={setPercent} />
            </label>
          </div>

          <section className={section}>
            <h3 className="text-sm font-semibold">Uygulanacak Ürünler</h3>
            <div className={optionGrid} role="group" aria-label="Uygulanacak ürünler">
              <Button type="button" variant={!onlySelected ? 'selected' : 'secondary'}
                aria-pressed={!onlySelected} onClick={() => setOnlySelected(false)}>Tüm Ürünler</Button>
              <Button type="button" variant={onlySelected ? 'selected' : 'secondary'}
                aria-pressed={onlySelected} onClick={() => setOnlySelected(true)}>Ürün Seç</Button>
            </div>
            {onlySelected && (products.length ? (
              <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                {products.map((product) => {
                  const isSelected = selected.includes(product.id);
                  return (
                    <Button key={product.id} type="button" variant={isSelected ? 'selected' : 'secondary'}
                      aria-pressed={isSelected} className="min-w-0 !justify-start break-words text-left"
                      onClick={() => setSelected((current) => isSelected ? current.filter((id) => id !== product.id) : [...current, product.id])}>
                      <span className="min-w-0">{product.name}</span>
                    </Button>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[var(--text-secondary)]">Seçilebilecek ürün yok.</p>)}
          </section>

          <section className={section}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Rutin</h3>
              <Button type="button" variant="ghost" size="sm" aria-expanded={isScheduled}
                onClick={() => setIsScheduled(!isScheduled)}>{isScheduled ? 'Rutin Kaldır' : '+ Rutin Ekle'}</Button>
            </div>
            {isScheduled && (
              <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Günler</p>
                  <div className="grid grid-cols-4 gap-1 sm:grid-cols-7" role="group" aria-label="Rutin günleri">
                    {DAY_LABELS.map((dayLabel, index) => {
                      const day = index + 1;
                      const isSelected = days.includes(day);
                      return (
                        <Button key={day} type="button" variant={isSelected ? 'selected' : 'secondary'}
                          className="!px-0" aria-pressed={isSelected}
                          onClick={() => setDays((current) => isSelected ? current.filter((item) => item !== day) : [...current, day].sort())}>
                          {dayLabel}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className={optionGrid}>
                  <label className={label}>Başlangıç saati
                    <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                  </label>
                  <label className={label}>Bitiş saati
                    <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                  </label>
                </div>
                <Button type="button" variant="ghost" size="sm" aria-expanded={hasDates} onClick={() => {
                  if (!hasDates && !validFrom && !validTo) setValidFrom(localDate(new Date()));
                  setHasDates(!hasDates);
                }}>{hasDates ? 'Tarih Sınırını Kaldır' : '+ Tarih Sınırı Ekle'}</Button>
                {hasDates && (
                  <div className={optionGrid}>
                    <label className={label}>Başlangıç tarihi
                      <Input type="date" value={validFrom} max={validTo || undefined} onChange={(event) => setValidFrom(event.target.value)} />
                    </label>
                    <label className={label}>Bitiş tarihi (isteğe bağlı)
                      <Input type="date" value={validTo} min={validFrom || undefined} onChange={(event) => setValidTo(event.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            )}
          </section>
        </fieldset>

        {error && <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button type="button" disabled={busy} onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" isLoading={busy}>Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
};
