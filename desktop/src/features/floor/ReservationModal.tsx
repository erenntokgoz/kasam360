import { ErrorToast } from '../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatDateTime } from '../../lib/date';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import type { FloorTable } from '../../types/floor';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Input } from '../../ui/Input';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';

interface ReservationData {
  tableId: string;
  tableNumber: string;
  customerName: string;
  customerPhone: string;
  guestCount: number;
  reservationTime: string;
  notes?: string;
}

interface ReservationRow {
  id: string;
  table_id: string;
  table_name?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  party_size: number;
  reserved_at: string;
  note?: string | null;
  status: string;
}

export interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: FloorTable[];
  onSaveReservation: (data: ReservationData) => Promise<void>;
  onUpdateReservation: (reservationId: string, data: ReservationData) => Promise<void>;
  onCloseReservation: (reservationId: string, action: 'ARRIVED' | 'CANCELLED') => Promise<void>;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Saat listesi çeyrek saatliktir: elle yazım hatası ve eksik saat olmaz. */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => `${pad(Math.floor(index / 4))}:${pad((index % 4) * 15)}`);

const fieldClass = 'w-full min-h-12 px-4 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] text-sm outline-none';
const labelClass = 'block text-sm font-semibold mb-1.5 text-[var(--text-secondary)]';

export const ReservationModal: React.FC<ReservationModalProps> = ({
  isOpen,
  onClose,
  tables,
  onSaveReservation,
  onUpdateReservation,
  onCloseReservation,
}) => {
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null);
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [guestCount, setGuestCount] = useState('2');
  const [day, setDay] = useState(() => localDate(new Date()));
  const [time, setTime] = useState('20:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      setRows(await invokeIPC<ReservationRow[]>('get_reservations', { callerRole: actorRole, callerTenantId: tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const resetForm = () => {
    setEditingId(null);
    setTableId('');
    setCustomerName('');
    setCustomerPhone('');
    setGuestCount('2');
    setDay(localDate(new Date()));
    setTime('20:00');
    setNotes('');
  };

  const startEdit = (row: ReservationRow) => {
    const at = new Date(row.reserved_at);
    setEditingId(row.id);
    setTableId(row.table_id);
    setCustomerName(row.customer_name);
    setCustomerPhone(row.customer_phone ?? '');
    setGuestCount(String(row.party_size));
    setDay(localDate(at));
    setTime(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
    setNotes(row.note ?? '');
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const table = tables.find((row) => row.id === tableId);
    if (!table) return;
    const data: ReservationData = {
      tableId,
      tableNumber: table.tableNumber,
      customerName,
      customerPhone,
      guestCount: Number.parseInt(guestCount, 10) || 1,
      // Yerel saat: UTC gününü almak gece yarısından sonra rezervasyonu düne yazardı.
      reservationTime: new Date(`${day}T${time}:00`).toISOString(),
      notes,
    };
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) await onUpdateReservation(editingId, data);
      else await onSaveReservation(data);
      resetForm();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const timeOptions = TIME_OPTIONS.includes(time) ? TIME_OPTIONS : [time, ...TIME_OPTIONS];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rezervasyonlar" maxWidth="5xl">
      <div className="grid lg:grid-cols-2 gap-4">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
          <h3 className="print-title text-sm font-bold">{editingId ? 'Rezervasyonu Düzenle' : 'Yeni Rezervasyon'}</h3>
          <div>
            <label htmlFor="reservation-name" className={labelClass}>Müşteri</label>
            <Input id="reservation-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reservation-phone" className={labelClass}>Telefon</label>
              <NumberInput id="reservation-phone" kind="digits" maxLength={15} value={customerPhone} onValueChange={setCustomerPhone} />
            </div>
            <div>
              <label htmlFor="reservation-guests" className={labelClass}>Kişi Sayısı</label>
              <NumberInput id="reservation-guests" kind="integer" value={guestCount} onValueChange={setGuestCount} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reservation-table" className={labelClass}>Masa</label>
              <select id="reservation-table" value={tableId} disabled={editingId !== null} onChange={(e) => setTableId(e.target.value)} className={fieldClass} required>
                <option value="">Masa seçin</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>{table.tableNumber} ({table.zoneName} · {table.capacity} kişilik)</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reservation-note" className={labelClass}>Not</label>
              <Input id="reservation-note" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reservation-day" className={labelClass}>Tarih</label>
              <Input id="reservation-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="reservation-time" className={labelClass}>Saat</label>
              <select id="reservation-time" value={time} onChange={(e) => setTime(e.target.value)} className={`${fieldClass} tabular-nums`}>
                {timeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          {error ? <ErrorToast message={error} /> : null}
          <div className="flex gap-2">
            {editingId ? <Button type="button" variant="secondary" className="flex-1" onClick={resetForm}>Vazgeç</Button> : null}
            <Button type="submit" variant="primary" className="flex-1" isLoading={isSaving}>Kaydet</Button>
          </div>
        </form>

        <div className="space-y-3 min-w-0">
          <h3 className="print-title text-sm font-bold">Bekleyenler</h3>
          {rows.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Bekleyen rezervasyon yok.</p> : null}
          <ul className="divide-y divide-[var(--border)] max-h-[30rem] overflow-y-auto pr-1">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-1.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold truncate">{row.customer_name}</span>
                  <span className="block text-sm text-[var(--text-secondary)] tabular-nums truncate">
                    {row.table_name ?? 'Masa'} · {formatDateTime(row.reserved_at)} · {row.party_size} kişi
                  </span>
                </span>
                {row.status === 'ACTIVE' ? (
                  <Button variant="ghost" aria-label={`${row.customer_name} düzenle`} onClick={() => startEdit(row)}>
                    <Pencil className="w-5 h-5" />
                  </Button>
                ) : null}
                <Button variant="ghost" aria-label={`${row.customer_name} iptal et`} onClick={() => setCancelling(row)}>
                  <Trash2 className="w-5 h-5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {cancelling ? (
        <ConfirmDialog
          title="Rezervasyon iptal edilsin mi?"
          message={`${cancelling.customer_name} · ${formatDateTime(cancelling.reserved_at)}`}
          confirmLabel="İptal Et"
          onConfirm={async () => {
            await onCloseReservation(cancelling.id, 'CANCELLED');
            if (editingId === cancelling.id) resetForm();
            await load();
          }}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </Modal>
  );
};
