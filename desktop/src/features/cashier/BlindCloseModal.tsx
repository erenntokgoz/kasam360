import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { useShiftStore } from '../../stores/shiftStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMoney } from '../../lib/formatMoney';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import type { ZReportData } from '../../types/shift';

export const BlindCloseModal: React.FC = () => {
  const { modals, closeModal, openModal } = useUIStore();
  const { closeShift } = useShiftStore();

  const [countedLiras, setCountedLiras] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedReport, setCompletedReport] = useState<ZReportData | null>(null);

  if (!modals.blindClose) return null;

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const liras = parseFloat(countedLiras) || 0;
    const cents = Math.round(liras * 100);

    setIsSubmitting(true);
    try {
      const zReport = await closeShift(cents, notes);
      setCompletedReport(zReport);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    setCompletedReport(null);
    setCountedLiras('');
    setNotes('');
    closeModal('blindClose');
    openModal('receiptPreview');
  };

  return (
    <Modal
      isOpen={modals.blindClose}
      onClose={() => closeModal('blindClose')}
      title="Vardiya Kapatma (Kör Sayım)"
      subtitle="Kasa çekmecesindeki fiziksel nakiti sayarak sisteme girin"
      maxWidth="md"
    >
      {!completedReport ? (
        <form onSubmit={handleCloseShift} className="space-y-4">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)] block">Kör Kapanış İlkesi:</span>
            Kasiyer sistem toplamını görmeden saydığı nakit parasını girer. Sistem farkı otomatik hesaplar ve Z Raporu ile denetim defterine mühürler.
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Sayılan Fiziksel Kasa Nakiti (₺)
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              value={countedLiras}
              onChange={(e) => setCountedLiras(e.target.value)}
              placeholder="Örn: 6350"
              className="text-lg font-bold tabular-nums"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--text-secondary)]">
              Kapanış Notu / Açıklama (Opsiyonel)
            </label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vardiya teslim notu..."
              className="text-xs"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => closeModal('blindClose')}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button
              type="submit"
              variant="danger"
              className="flex-1"
              isLoading={isSubmitting}
            >
              Vardiyayı Kapat ve Mühürle
            </Button>
          </div>
        </form>
      ) : (
        /* Kapanış Tamamlandı Rapor Özeti */
        <div className="space-y-4">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-xl p-4 divide-y divide-[var(--border)] text-xs">
            <div className="pb-2 flex justify-between">
              <span className="text-[var(--text-secondary)]">Rapor No:</span>
              <span className="font-bold text-[var(--text-primary)] font-mono">{completedReport.reportNumber}</span>
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

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleDone}
            className="w-full"
          >
            <FileText className="w-4 h-4 mr-1.5" />
            <span>Z Raporunu Gör ve Yazdır</span>
          </Button>
        </div>
      )}
    </Modal>
  );
};
