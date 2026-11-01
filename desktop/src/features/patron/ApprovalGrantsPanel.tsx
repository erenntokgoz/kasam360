import React, { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  can_approve: boolean;
}

/** Patron, müdür olmayan personele iptal, ikram ve iade onayı verebilir. */
export const ApprovalGrantsPanel: React.FC = () => {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { actorRole, tenantId } = sessionArgs();
      setStaff(await invokeIPC<StaffRow[]>('get_staff', { actorRole, tenantId }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (member: StaffRow) => {
    setError(null);
    try {
      const { actorId, actorRole, tenantId } = sessionArgs();
      await invokeIPC('set_staff_approval', {
        staffId: member.id,
        canApprove: !member.can_approve,
        actorId,
        actorRole,
        tenantId,
      });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const grantable = staff?.filter((member) => member.role !== 'OWNER' && member.role !== 'MANAGER') ?? [];

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
      <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Onay yetkisi</h2>
      <p className="text-xs text-[var(--text-secondary)]">
        Patron ve müdür her zaman yetkilidir. Yetki verdiğiniz personel iptal, ikram ve iadeyi kendi PIN'iyle onaylar.
      </p>
      {staff && grantable.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">Yetki verilebilecek personel yok.</p>
      ) : null}
      <ul className="divide-y divide-[var(--border)]">
        {grantable.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 text-sm font-semibold text-[var(--text-primary)] truncate">{member.name}</span>
            <Button
              variant={member.can_approve ? 'selected' : 'secondary'}
              className="min-h-12 shrink-0"
              onClick={() => void toggle(member)}
            >
              {member.can_approve ? 'Yetkiyi Kaldır' : 'Yetki Ver'}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
    </section>
  );
};
