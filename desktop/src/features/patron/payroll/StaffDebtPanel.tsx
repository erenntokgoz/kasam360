import { ErrorToast } from '../../../ui/ErrorToast';
import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../lib/cariInput';
import { formatDay } from '../../../lib/date';
import { formatMoney } from '../../../lib/formatMoney';
import { hoursText } from '../../../lib/payPeriod';
import { invokeIPC } from '../../../services/tauriClient';
import { sessionArgs } from '../../../stores/cariStore';
import { Modal } from '../../../ui/Modal';
import { RecordCard } from '../RecordCard';
import { SettlementPayForm } from './SettlementPayForm';
import { STATUS_LABEL, type StaffSettlement } from './settlement';

interface StaffDebtPanelProps {
  userId: string;
  /** Üst bileşen yeni hesap kestiğinde listeyi yenilemek için artar. */
  refreshKey?: number;
  onChanged?: () => void;
}

/** Kişinin çıkış hesapları: ödenmeyen kısım personel borcudur ve buradan kapatılır. */
export const StaffDebtPanel: React.FC<StaffDebtPanelProps> = ({ userId, refreshKey = 0, onChanged }) => {
  const [rows, setRows] = useState<StaffSettlement[] | null>(null);
  const [paying, setPaying] = useState<StaffSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      setRows(await invokeIPC<StaffSettlement[]>('list_staff_settlements', { tenantId, actorRole, userId, onlyOpen: false }));
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const open = rows?.filter((row) => row.status !== 'PAID') ?? [];
  const total = open.reduce((sum, row) => sum + (row.remainingCents ?? 0), 0);
  const hidden = open.some((row) => row.remainingCents === null);

  return (
    <div className="space-y-3">
      {error ? <ErrorToast message={error} /> : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Çıkış hesabı yok.</p>
      ) : (
        <>
          <p className="text-sm font-semibold tabular-nums">Personel borcu {hidden ? 'Gizli' : formatMoney(total)}</p>
          <ul className="grid gap-2 md:grid-cols-2">
            {rows.map((row) => (
              <li key={row.id}>
                <RecordCard
                  title={`${formatDay(row.workDate)} · ${STATUS_LABEL[row.status]}`}
                  description={row.kind === 'HOURLY' ? `${hoursText(row.workedSeconds)} saat` : 'Günlük ücret'}
                  value={row.remainingCents === null || row.earnedCents === null ? 'Gizli' : formatMoney(row.status === 'PAID' ? row.earnedCents : row.remainingCents)}
                  onOpen={() => setPaying(row)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {paying ? (
        <Modal cardFlow isOpen title={`${paying.fullName} · ${formatDay(paying.workDate)}`} maxWidth="sm" onClose={() => setPaying(null)}>
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-3 text-sm tabular-nums">
              <div><dt className="text-xs text-[var(--text-secondary)]">Ücret</dt><dd className="font-semibold">{paying.earnedCents === null ? 'Gizli' : formatMoney(paying.earnedCents)}</dd></div>
              <div><dt className="text-xs text-[var(--text-secondary)]">Ödenen</dt><dd className="font-semibold">{paying.paidCents === null ? 'Gizli' : formatMoney(paying.paidCents)}</dd></div>
              <div><dt className="text-xs text-[var(--text-secondary)]">Kalan</dt><dd className="font-semibold">{paying.remainingCents === null ? 'Gizli' : formatMoney(paying.remainingCents)}</dd></div>
            </dl>
            {paying.remainingCents !== null && paying.remainingCents > 0 ? (
              <SettlementPayForm
                settlement={paying}
                remainingCents={paying.remainingCents}
                initialAmountCents={paying.remainingCents}
                onPaid={() => {
                  setPaying(null);
                  void load();
                  onChanged?.();
                }}
              />
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
};
