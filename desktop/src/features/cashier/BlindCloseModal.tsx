import { ErrorToast } from '../../ui/ErrorToast';
import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { NumberInput } from '../../ui/NumberInput';
import { useShiftStore } from '../../stores/shiftStore';
import { useUIStore } from '../../stores/uiStore';
import { useFloorStore } from '../../stores/floorStore';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { parseCents } from '../../lib/moneyInput';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Numpad } from '../../ui/Numpad';
import type { ZReportData } from '../../types/shift';

export const BlindCloseModal: React.FC<{ onShowZ: () => void }> = ({ onShowZ }) => {
  const modals = useUIStore((state) => state.modals);
  const closeModal = useUIStore((state) => state.closeModal);
  const { closeShift, explainDifference } = useShiftStore();
  const openTables = useFloorStore((state) => state.tables.filter((table) => table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED').length);

  const [countedLiras, setCountedLiras] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedReport, setCompletedReport] = useState<ZReportData | null>(null);
  // Mühür geri alınamaz: sayım bir kez daha gösterilip onay alınır.
  const [pendingCents, setPendingCents] = useState<number | null>(null);

  if (!modals.blindClose) return null;

  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    // Geçersiz sayım sıfır kabul edilmez: kasa farkı buradan doğar.
    const cents = parseCents(countedLiras);
    if (cents === null) {
      setError('Sayılan tutarı rakamla girin.');
      return;
    }
    setError(null);
    setOperationError(null);
    setPendingCents(cents);
  };

  const handleSeal = async () => {
    if (pendingCents === null || isSubmitting) return;
    const cents = pendingCents;
    setIsSubmitting(true);
    setError(null);
    setOperationError(null);
    try {
      setCompletedReport(await closeShift(cents));
      setPendingCents(null);
    } catch (caught) {
      setOperationError(errorText(caught));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = async () => {
    if (completedReport && completedReport.differenceCents !== 0) {
      setIsSubmitting(true);
      setOperationError(null);
      try {
        await explainDifference(completedReport.shiftId, note);
      } catch (caught) {
        setOperationError(errorText(caught));
        return;
      } finally {
        setIsSubmitting(false);
      }
    }
    setCompletedReport(null);
    setCountedLiras('');
    setNote('');
    closeModal('blindClose');
    onShowZ();
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setPendingCents(null);
    setError(null);
    setOperationError(null);
    closeModal('blindClose');
  };

  return (
    <Modal
      cardFlow
      isOpen={modals.blindClose}
      onClose={handleClose}
      title="Vardiya Kapatma"
      subtitle={completedReport ? '3 / 3 · Kapanış Özeti' : pendingCents !== null ? '2 / 3 · Sayımı Onayla' : '1 / 3 · Kör Sayım'}
      maxWidth="md"
    >
      <ErrorToast message={operationError} />
      {pendingCents !== null && !completedReport ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-primary)]">
            Sayılan nakit <span className="font-bold tabular-nums">{formatMoney(pendingCents)}</span>. Vardiya mühürlenince geri açılamaz.
          </p>
          {openTables > 0 ? (
            <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">
              Salonda {openTables} açık masa var. Hesapları kapatmadan mühürlerseniz bu satışlar sonraki vardiyaya yazılır.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" disabled={isSubmitting} onClick={() => setPendingCents(null)}>
              Sayımı Düzelt
            </Button>
            <Button type="button" variant="danger" className="flex-1" isLoading={isSubmitting} onClick={() => void handleSeal()}>
              Mühürle
            </Button>
          </div>
        </div>
      ) : !completedReport ? (
        <form onSubmit={handleCloseShift} className="space-y-4">

          <div>
            <label htmlFor="counted-cash" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Sayılan Fiziksel Kasa Nakiti (₺)
            </label>
            <NumberInput
              id="counted-cash"
              pinpad={false}
              value={countedLiras}
              onValueChange={setCountedLiras}
              className="text-lg font-bold tabular-nums"
              required
            />
          </div>

          <Numpad
            buttonHeightClass="!min-h-14"
            onDigit={(digit) => {
              if (countedLiras.length < 7) setCountedLiras(countedLiras + digit);
            }}
            onClear={() => setCountedLiras('')}
            onBackspace={() => setCountedLiras(countedLiras.slice(0, -1))}
          />

          {error ? (
            <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
            >
              Devam
            </Button>
          </div>
        </form>
      ) : (
        /* Kapanış Tamamlandı Rapor Özeti */
        <div className="space-y-4">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-4 divide-y divide-[var(--border)] text-xs">
            <div className="pb-2 flex justify-between">
              <span className="text-[var(--text-secondary)]">Rapor No:</span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">{completedReport.reportNumber}</span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-[var(--text-secondary)]">Sayılan Nakit:</span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(completedReport.countedCashCents)}
              </span>
            </div>
            <div className="py-2 flex justify-between">
              <span className="text-[var(--text-secondary)]">Sistemde Beklenen:</span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(completedReport.expectedCashCents)}
              </span>
            </div>
            <div className="pt-2 flex justify-between items-center">
              <span className="text-[var(--text-secondary)] font-semibold">Kasa Farkı:</span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  completedReport.differenceCents === 0
                    ? 'text-[var(--accent-emerald)]'
                    : completedReport.differenceCents > 0
                    ? 'text-[var(--accent-blue)]'
                    : 'text-[var(--accent-red)]'
                }`}
              >
                {completedReport.differenceCents === 0
                  ? 'Fark Yok (Kusursuz)'
                  : formatMoney(completedReport.differenceCents)}
              </span>
            </div>
          </div>

          {completedReport.differenceCents !== 0 ? (
            <div>
              <label htmlFor="difference-note" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Kasa farkının açıklaması
              </label>
              <Input id="difference-note" className="min-h-12" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => void handleDone()}
            disabled={completedReport.differenceCents !== 0 && note.trim().length === 0}
            isLoading={isSubmitting}
            className="w-full"
          >
            <FileText className="w-4 h-4 mr-1.5" />
            <span>Z Raporunu Göster</span>
          </Button>
        </div>
      )}
    </Modal>
  );
};
