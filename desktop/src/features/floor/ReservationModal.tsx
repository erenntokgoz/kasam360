import React, { useState } from 'react';
import type { FloorTable } from '../../types/floor';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

export interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: FloorTable[];
  onSaveReservation: (data: {
    tableId: string;
    tableNumber: string;
    customerName: string;
    customerPhone: string;
    guestCount: number;
    reservationTime: string;
    notes?: string;
  }) => void;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({
  isOpen,
  onClose,
  tables,
  onSaveReservation,
}) => {
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [guestCount, setGuestCount] = useState(2);
  const [resTime, setResTime] = useState('20:00');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    // Bugünün tarihi ile saat birleştir
    const today = new Date().toISOString().split('T')[0];
    const fullTimeStr = new Date(`${today}T${resTime}:00`).toISOString();

    onSaveReservation({
      tableId,
      tableNumber: table.tableNumber,
      customerName,
      customerPhone,
      guestCount,
      reservationTime: fullTimeStr,
      notes,
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Yeni Masa Rezervasyonu"
      subtitle="Rezerve saatine 60 dakika kala masa otomatik kilitlenir."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Müşteri Adı Soyadı
          </label>
          <Input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Örn: Caner Erkin"
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Telefon
            </label>
            <Input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="0532..."
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Kişi Sayısı
            </label>
            <Input
              type="number"
              min="1"
              max="20"
              value={guestCount}
              onChange={(e) => setGuestCount(parseInt(e.target.value, 10) || 1)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Masa Seçimi
            </label>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none"
              required
            >
              <option value="">Masa seçin...</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tableNumber} ({t.zoneName} · {t.capacity}K)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Rezervasyon Saati
            </label>
            <Input
              type="time"
              value={resTime}
              onChange={(e) => setResTime(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
            Özel Not / İstek
          </label>
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Örn: Cam kenarı rica edildi"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" className="flex-1">
            Rezervasyonu Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
};
