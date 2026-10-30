import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { useFloorStore } from '../../stores/floorStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';

export const AddTableModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const addTable = useFloorStore((state) => state.addTable);
  const [name, setName] = useState('');
  const [zone, setZone] = useState('Salon');
  const [seats, setSeats] = useState('4');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const save = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await addTable(name.trim(), zone.trim(), Number.parseInt(seats, 10) || 1);
      setName('');
      onClose();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Masa Ekle" maxWidth="sm">
      <div className="space-y-3">
        <div>
          <label htmlFor="table-name" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">Masa Adı *</label>
          <Input id="table-name" className="min-h-12" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label htmlFor="table-zone" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">Bölüm</label>
          <Input id="table-zone" className="min-h-12" value={zone} maxLength={40} onChange={(e) => setZone(e.target.value)} />
        </div>
        <div>
          <label htmlFor="table-seats" className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">Kişi Sayısı</label>
          <Input id="table-seats" className="min-h-12 tabular-nums" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
        {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
        <Button type="button" variant="primary" className="w-full min-h-12" disabled={!name.trim() || !zone.trim()} isLoading={isBusy} onClick={() => void save()}>
          Kaydet
        </Button>
      </div>
    </Modal>
  );
};
