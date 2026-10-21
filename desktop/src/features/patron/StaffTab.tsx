import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { formatMoney } from '../../lib/formatMoney';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';

export const StaffTab: React.FC = () => {
  const { staffProfiles, giveStaffAdvance } = useLedgerStore();

  const [advanceStaffId, setAdvanceStaffId] = useState<string | null>(null);
  const [advanceLiras, setAdvanceLiras] = useState('');

  const selectedStaff = staffProfiles.find((s) => s.id === advanceStaffId) || null;

  const handleGiveAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advanceStaffId) return;
    const liras = parseFloat(advanceLiras) || 0;
    const cents = Math.round(liras * 100);
    await giveStaffAdvance(advanceStaffId, cents);
    setAdvanceStaffId(null);
    setAdvanceLiras('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          Personel, Avans ve Prim Yönetimi
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          Personel bazında maaş, verilen avanslar ve satıştan hak kazanılan primler.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {staffProfiles.map((staff) => (
          <div
            key={staff.id}
            className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm space-y-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-sm font-bold text-[var(--text-primary)] block">
                  {staff.name}
                </span>
                <span className="text-xs text-[var(--text-muted)] block mt-0.5">{staff.role}</span>
              </div>
              <Button
                variant="outline-amber"
                size="sm"
                onClick={() => setAdvanceStaffId(staff.id)}
                className="text-xs !min-h-[32px]"
              >
                + Avans Ver
              </Button>
            </div>

            <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Sabit Maaş:</span>
                <span className="font-bold tabular-nums text-[var(--text-primary)]">
                  {formatMoney(staff.baseSalaryCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Açık Avans:</span>
                <span className="font-bold tabular-nums text-[var(--accent-red)]">
                  {formatMoney(staff.advanceBalanceCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Aylık Prim:</span>
                <span className="font-bold tabular-nums text-[var(--accent-emerald)]">
                  {formatMoney(staff.monthlyCommissionCents)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
              <span>{staff.ordersServed} Sipariş Tamamladı</span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(staff.totalSalesCents)} Ciro
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Avans Verme Modalı */}
      <Modal
        isOpen={advanceStaffId !== null}
        onClose={() => setAdvanceStaffId(null)}
        title="Personel Avans Ödemesi"
        subtitle={selectedStaff?.name}
        maxWidth="sm"
      >
        <form onSubmit={handleGiveAdvance} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Verilecek Avans Tutarı (₺)
            </label>
            <Input
              type="number"
              min="1"
              step="50"
              value={advanceLiras}
              onChange={(e) => setAdvanceLiras(e.target.value)}
              placeholder="Örn: 1000"
              className="text-base font-bold tabular-nums"
              required
              autoFocus
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdvanceStaffId(null)}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              Avansı Kasadan Çık ve Kaydet
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
