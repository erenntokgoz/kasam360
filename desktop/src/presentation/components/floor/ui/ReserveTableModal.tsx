import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Phone, Users, X } from 'lucide-react';
import { useModalA11y } from '../../../hooks/useModalA11y';

export interface ReserveTableInput {
  customerName: string;
  customerPhone?: string;
  partySize: number;
  reservedAt: string;
  note?: string;
}

export interface ReserveTableModalProps {
  tableName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: ReserveTableInput) => Promise<void> | void;
}

/** `datetime-local` girdisinin beklediği yerel biçimi üretir (ISO'nu değil). */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

const FIELD_CLASS =
  'w-full rounded-2xl px-4 py-3 text-sm dark:text-white text-zinc-900 bg-black/[0.03] dark:bg-white/[0.05] border dark:border-white/10 border-black/[0.08] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/40 transition-shadow placeholder:text-zinc-400';

const LABEL_CLASS = 'block text-[11px] font-semibold dark:text-white/60 text-zinc-600 mb-1.5';

/**
 * Hızlı rezervasyon penceresi.
 *
 * Neden ayrı pencere: boş masadaki "Hızlı Rezerve Et" ikonu müşteri adı, telefon,
 * kişi sayısı ve randevu saati ister. Rezervasyon kaydı bu bilgileri saklamazsa
 * salon planındaki mor blok "Rezerve" yazan boş bir etikete dönüşür ve garson
 * "bu masa kimin?" sorusunu cevaplayamaz. Alan zorunluluğu: müşteri adı ve
 * randevu saati boş bırakılırsa kayıt reddedilir (backend `VALIDATION`).
 */
export function ReserveTableModal({ tableName, isOpen, onClose, onSubmit }: ReserveTableModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [reservedAt, setReservedAt] = useState(() => toLocalInputValue(new Date(Date.now() + 30 * 60000)));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { modalRef, handleBackdropClick } = useModalA11y({ isOpen, onClose });

  // Boş bırakılan alanları kullanıcıya yazmadan önce göster; backend'in hata
  // metni teknik göründüğü için burada düz Türkçe uyarı verilir.
  const validationError = useMemo(() => {
    if (!customerName.trim()) return 'Müşteri adı zorunludur.';
    if (!reservedAt) return 'Randevu saati zorunludur.';
    if (!Number.isFinite(partySize) || partySize < 1) return 'Kişi sayısı en az 1 olmalıdır.';
    return null;
  }, [customerName, reservedAt, partySize]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const parsed = new Date(reservedAt);
      await onSubmit({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        partySize,
        reservedAt: Number.isNaN(parsed.getTime()) ? reservedAt : parsed.toISOString(),
        note: note.trim() || undefined,
      });
      setCustomerName('');
      setCustomerPhone('');
      setPartySize(2);
      setNote('');
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reserve-table-title"
        className="dark:bg-white/[0.04] bg-white/85 dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col backdrop-blur-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="p-6 border-b dark:border-white/10 border-black/[0.08] flex justify-between items-start">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[#5856D6]/15 text-[#5856D6] dark:text-[#5E5CE6]">
              <CalendarClock className="w-5 h-5" />
            </span>
            <div>
              <h2 id="reserve-table-title" className="text-lg font-semibold tracking-tight dark:text-white text-zinc-900">
                {tableName} — Rezervasyon
              </h2>
              <p className="text-[11px] dark:text-white/50 text-zinc-500">
                Rezervasyon yalnızca boş masalara yazılır.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded-full p-2 dark:text-white/50 text-zinc-400 hover:dark:bg-white/[0.08] hover:bg-black/[0.05] hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="reserve-customer" className={LABEL_CLASS}>
              Müşteri Adı *
            </label>
            <input
              id="reserve-customer"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Örn. Ayşe Yılmaz"
              autoFocus
              className={FIELD_CLASS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reserve-phone" className={LABEL_CLASS}>
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Telefon
                </span>
              </label>
              <input
                id="reserve-phone"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="0555 000 00 00"
                inputMode="tel"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="reserve-party" className={LABEL_CLASS}>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3 h-3" /> Kişi Sayısı
                </span>
              </label>
              <input
                id="reserve-party"
                type="number"
                min={1}
                max={500}
                value={partySize}
                onChange={(event) => setPartySize(Number(event.target.value))}
                className={FIELD_CLASS}
              />
            </div>
          </div>

          <div>
            <label htmlFor="reserve-time" className={LABEL_CLASS}>
              Randevu Saati *
            </label>
            <input
              id="reserve-time"
              type="datetime-local"
              value={reservedAt}
              onChange={(event) => setReservedAt(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="reserve-note" className={LABEL_CLASS}>
              Not
            </label>
            <textarea
              id="reserve-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Örn. Pencere kenarı, bebek sandalyesi"
              className={`${FIELD_CLASS} resize-none`}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-[#FF3B30] dark:text-[#FF453A]">
              {error}
            </p>
          )}
        </div>

        <div className="p-6 pt-0 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.1] dark:text-white/80 text-zinc-700 hover:text-zinc-900 transition-colors text-xs font-medium cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="px-6 py-2.5 rounded-2xl bg-[#5856D6] hover:bg-[#4846B8] text-white text-xs font-semibold shadow-lg shadow-[#5856D6]/25 flex items-center gap-2 cursor-pointer active:scale-95 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Kaydediliyor…</span>
              </>
            ) : (
              <span>Rezerve Et</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
