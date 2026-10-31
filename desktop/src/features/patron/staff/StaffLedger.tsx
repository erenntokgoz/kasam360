import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { errorText } from '../../../lib/cariInput';
import { invokeIPC } from '../../../services/tauriClient';
import { useAuthStore } from '../../../stores/authStore';
import { sessionArgs } from '../../../stores/cariStore';
import { useLedgerStore } from '../../../stores/ledgerStore';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { PayrollPanel } from '../payroll/PayrollPanel';
import { SectionTabs, type SectionTab } from '../SectionTabs';
import { ROLE_LABEL, StaffFormModal, type StaffMember } from '../StaffFormModal';
import { TipPoolPanel } from '../TipPoolPanel';
import { StaffCard, type ProfileRow } from './StaffCard';

type LedgerSection = 'PEOPLE' | 'PAYROLL' | 'TIPS';

const SECTIONS: SectionTab<LedgerSection>[] = [
  { id: 'PEOPLE', label: 'Kişiler' },
  { id: 'PAYROLL', label: 'Bordro' },
  { id: 'TIPS', label: 'Bahşiş Havuzu' },
];

/** Personel ve bordro tek defter. Pasif personel listede kalır: geçmiş kayıtlar ona bağlıdır. */
export const StaffLedger: React.FC = () => {
  const isOwner = useAuthStore((state) => state.user?.role === 'OWNER');
  const erpSection = useLedgerStore((state) => state.erpSection);
  const [section, setSection] = useState<LedgerSection>('PEOPLE');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (erpSection === 'PAYROLL') setSection('PAYROLL');
  }, [erpSection]);

  const selected = staff?.find((member) => member.id === selectedId) ?? null;
  const active = staff?.filter((member) => member.is_active) ?? [];
  const editingProfile = editing && editing !== 'NEW' ? profiles[editing.id] : undefined;

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTabs label="Personel Defteri" tabs={SECTIONS} active={section} onChange={setSection} />
        <Button variant="primary" className="min-h-12 shrink-0" onClick={() => setEditing('NEW')}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          <span>Personel Ekle</span>
        </Button>
      </div>

      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">Personel okunamadı: {error}</p> : null}

      {section === 'PEOPLE' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] self-start">
            {(staff ?? []).map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  aria-current={member.id === selectedId}
                  className={`w-full min-h-14 px-4 py-2 text-left cursor-pointer ${member.id === selectedId ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'} ${member.is_active ? '' : 'opacity-60'}`}
                >
                  <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{member.name}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">
                    {ROLE_LABEL[member.role] ?? member.role}{member.is_active ? '' : ' · Pasif'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <StaffCard
              key={selected.id}
              member={selected}
              profile={profiles[selected.id]}
              isOwner={isOwner}
              onEdit={() => setEditing(selected)}
              onChanged={load}
            />
          ) : (
            <p className="p-6 text-center text-xs text-[var(--text-muted)] paper border border-[var(--border)] rounded-xl">
              Kartını görmek için listeden bir kişi seçin.
            </p>
          )}
        </div>
      ) : null}

      {section === 'PAYROLL' ? <PayrollPanel /> : null}

      {section === 'TIPS' ? (
        <div className="space-y-4 max-w-3xl">
          {isOwner ? (
            <ul className="paper border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
              {active.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2 min-h-14">
                  <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{member.name}</span>
                  <Input
                    aria-label={`${member.name} bahşiş payı`}
                    inputMode="numeric"
                    placeholder="Pay"
                    className="min-h-12 !w-20"
                    value={shares[member.id] ?? ''}
                    onChange={(event) => setShares({ ...shares, [member.id]: event.target.value })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <TipPoolPanel canDistribute={isOwner} staffIds={active.map((member) => member.id)} shares={shares} />
        </div>
      ) : null}

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
