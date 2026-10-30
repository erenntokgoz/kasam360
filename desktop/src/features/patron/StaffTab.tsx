import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { ROLE_LABEL, StaffFormModal, type StaffMember } from './StaffFormModal';
import { TipPoolPanel } from './TipPoolPanel';

interface ProfileRow {
  userId: string;
  baseSalaryCents: number | null;
  phone: string | null;
}

/** Personel kayıtları. Pasif personel listede kalır: geçmiş kayıtlar ona bağlıdır. */
export const StaffTab: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [editing, setEditing] = useState<StaffMember | 'NEW' | null>(null);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [rows, details] = await Promise.all([
        invokeIPC<StaffMember[]>('get_staff', { actorRole, tenantId, includeInactive: true }),
        invokeIPC<ProfileRow[]>('list_staff_profiles', { actorRole, tenantId }),
      ]);
      setStaff(rows);
      setProfiles(Object.fromEntries(details.map((profile) => [profile.userId, profile])));
      setError(null);
    } catch (caught) {
      setStaff(null);
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const salaryText = (id: string) => {
    const profile = profiles[id];
    if (!profile) return 'Maaş girilmedi';
    return profile.baseSalaryCents == null ? 'Gizli' : formatMoney(profile.baseSalaryCents);
  };

  const active = staff?.filter((member) => member.is_active) ?? [];
  const editingProfile = editing && editing !== 'NEW' ? profiles[editing.id] : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Personel</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Rol ekranları, PIN girişi belirler. Pay alanı bahşiş dağıtımı içindir.
          </p>
        </div>
        <Button variant="primary" className="min-h-12 shrink-0" onClick={() => setEditing('NEW')}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          <span>Personel Ekle</span>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          Personel okunamadı: {error}
        </p>
      ) : null}

      <ul className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {(staff ?? []).map((member) => (
          <li key={member.id} className={`flex items-center gap-3 px-4 py-2 min-h-14 ${member.is_active ? '' : 'opacity-60'}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">{member.name}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {ROLE_LABEL[member.role] ?? member.role}
                {member.is_active ? '' : ' · Pasif'}
                {profiles[member.id]?.phone ? ` · ${profiles[member.id].phone}` : ''}
              </p>
            </div>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">{salaryText(member.id)}</span>
            {isOwner && member.is_active ? (
              <Input
                aria-label={`${member.name} bahşiş payı`}
                inputMode="numeric"
                placeholder="Pay"
                className="min-h-12 w-20"
                value={shares[member.id] ?? ''}
                onChange={(event) => setShares({ ...shares, [member.id]: event.target.value })}
              />
            ) : null}
            {member.role !== 'OWNER' ? (
              <Button variant="secondary" className="min-h-12" onClick={() => setEditing(member)} aria-label={`${member.name} düzenle`}>
                <Pencil className="w-4 h-4 mr-1" />
                <span>Düzenle</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <TipPoolPanel canDistribute={isOwner} staffIds={active.map((member) => member.id)} shares={shares} />

      {editing ? (
        <StaffFormModal
          member={editing === 'NEW' ? null : editing}
          phone={editingProfile?.phone ?? ''}
          salaryCents={editingProfile?.baseSalaryCents ?? null}
          canSetSalary={isOwner}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
};
